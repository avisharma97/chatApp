import { Router } from "express";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/require-auth.js";
import { cloudinary } from "../lib/cloudinary.js";
import type { UploadApiErrorResponse, UploadApiResponse } from "cloudinary";
import { getIO } from "../lib/socket.js";
export const uploadsRouter = Router();

uploadsRouter.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 1,
  },
});

const receiveMedia = (
  req: Parameters<typeof upload.single>[0] extends never
    ? never
    : import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) => {
  upload.single("file")(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;

      res.status(status).json({
        error: status === 413 ? "FILE_TOO_LARGE" : "INVALID_UPLOAD",
      });
      return;
    }

    if (error) {
      next(error);
      return;
    }

    next();
  });
};

uploadsRouter.post("/:conversationId/media", async (req, res, next) => {
  const conversationId = z.string().uuid().safeParse(req.params.conversationId);

  if (!conversationId.success) {
    return res.status(400).json({ error: "INVALID_CONVERSATION_ID" });
  }

  if (!req.userId) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }

  try {
    const membership = await prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId: conversationId.data,
          userId: req.userId,
        },
      },
      select: { userId: true },
    });

    if (!membership) {
      return res.status(404).json({
        error: "CONVERSATION_NOT_FOUND",
      });
    }

    // Only parse the file after authentication and membership checks.
    receiveMedia(req, res, (uploadError) => {
      if (uploadError) {
        next(uploadError);
        return;
      }

      void (async () => {
        try {
          const formSchema = z.object({
            clientMessageId: z.string().uuid(),
            caption: z.string().trim().max(5000).optional().default(""),
          });

          const parsedForm = formSchema.safeParse({
            clientMessageId: req.body?.clientMessageId,
            caption: req.body?.caption,
          });

          if (!parsedForm.success) {
            res.status(400).json({ error: "INVALID_INPUT" });
            return;
          }
          const file = req.file;

          if (!file) {
            res.status(400).json({ error: "FILE_REQUIRED" });
            return;
          }
          const { clientMessageId, caption } = parsedForm.data;

          const existing = await prisma.message.findFirst({
            where: {
              senderId: req.userId!,
              clientMessageId,
            },
          });

          if (existing) {
            if (existing.conversationId !== conversationId.data) {
              res.status(409).json({
                error: "CLIENT_MESSAGE_ID_ALREADY_USED",
              });
              return;
            }

            res.status(200).json({
              message: existing,
              duplicate: true,
            });
            return;
          }

          const detected = await fileTypeFromBuffer(file.buffer);

          const allowedTypes = new Map<string, "image" | "video">([
            ["image/jpeg", "image"],
            ["image/png", "image"],
            ["image/webp", "image"],
            ["image/gif", "image"],
            ["video/mp4", "video"],
            ["video/webm", "video"],
            ["video/quicktime", "video"],
          ]);

          const resourceType: "image" | "video" | undefined = detected
            ? allowedTypes.get(detected.mime)
            : undefined;

          if (!detected || !resourceType) {
            res.status(415).json({
              error: "UNSUPPORTED_MEDIA_TYPE",
            });
            return;
          }

          const result = await new Promise<{
            secure_url: string;
            public_id: string;
            bytes: number;
            format: string;
            resource_type: string;
          }>((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              {
                folder: `chatapp/${conversationId.data}`,
                resource_type: resourceType,
              },
              (
                error: UploadApiErrorResponse | undefined,
                uploaded: UploadApiResponse | undefined,
              ) => {
                if (error) {
                  reject(error);
                  return;
                }

                if (!uploaded) {
                  reject(new Error("Cloudinary returned no upload result"));
                  return;
                }

                resolve(uploaded);
              },
            );

            stream.end(file.buffer);
          });

          const message = await prisma.$transaction(async (tx) => {
            const created = await tx.message.create({
              data: {
                conversationId: conversationId.data,
                senderId: req.userId!,
                clientMessageId,
                content: caption,
                mediaUrl: result.secure_url,
                mediaPublicId: result.public_id,
                mediaMimeType: detected.mime,
                mediaResourceType: result.resource_type,
                mediaSize: result.bytes,
                mediaOriginalName: file.originalname.slice(0, 255),
              },
            });

            const recipients = await tx.conversationMember.findMany({
              where: {
                conversationId: conversationId.data,
                userId: { not: req.userId! },
              },
              select: { userId: true },
            });

            if (recipients.length > 0) {
              await tx.messageReceipt.createMany({
                data: recipients.map((recipient) => ({
                  messageId: created.id,
                  userId: recipient.userId,
                })),
                skipDuplicates: true,
              });
            }

            await tx.conversation.update({
              where: { id: conversationId.data },
              data: { updatedAt: new Date() },
            });

            return created;
          });

          getIO()
            .to(`conversation:${conversationId.data}`)
            .emit("message:new", message);

          res.status(201).json({
            message,
            duplicate: false,
          });
        } catch (error) {
          req.log?.error({ err: error }, "Media upload failed");
          res.status(502).json({ error: "MEDIA_UPLOAD_FAILED" });
        }
      })();
    });
  } catch (error) {
    next(error);
  }
});

uploadsRouter.post("/avatar", (req, res, next) => {
  if (!req.userId) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }

  receiveMedia(req, res, (uploadError) => {
    if (uploadError) {
      next(uploadError);
      return;
    }

    void (async () => {
      try {
        const file = req.file;

        if (!file) {
          res.status(400).json({ error: "FILE_REQUIRED" });
          return;
        }

        // Avatar images: maximum 5 MB.
        if (file.size > 5 * 1024 * 1024) {
          res.status(413).json({ error: "AVATAR_TOO_LARGE" });
          return;
        }

        const detected = await fileTypeFromBuffer(file.buffer);

        const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);

        if (!detected || !allowed.has(detected.mime)) {
          res.status(415).json({ error: "INVALID_AVATAR_TYPE" });
          return;
        }

        const result = await new Promise<UploadApiResponse>(
          (resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              {
                folder: "chatapp/avatars",
                resource_type: "image",
                transformation: [
                  { width: 512, height: 512, crop: "fill", gravity: "face" },
                ],
              },
              (error, uploaded) => {
                if (error) {
                  reject(error);
                  return;
                }

                if (!uploaded) {
                  reject(new Error("Cloudinary returned no upload result"));
                  return;
                }

                resolve(uploaded);
              },
            );

            stream.end(file.buffer);
          },
        );

        const user = await prisma.user.update({
          where: { id: req.userId! },
          data: { avatarUrl: result.secure_url },
          select: {
            id: true,
            email: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        });

        res.json({ user });
      } catch (error) {
        req.log?.error({ err: error }, "Avatar upload failed");
        res.status(502).json({ error: "AVATAR_UPLOAD_FAILED" });
      }
    })();
  });
});
