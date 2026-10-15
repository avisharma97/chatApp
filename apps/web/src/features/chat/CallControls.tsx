"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

type CallType = "audio" | "video";
type SignalKind = "offer" | "answer" | "ice";

type CallInfo = {
  callId: string;
  conversationId: string;
  type: CallType;
  callerId?: string;
  reason?: string;
};

type SignalEvent = {
  callId: string;
  kind: SignalKind;
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit;
};

type Ack = {
  ok: boolean;
  error?: string;
  callId?: string;
};

type Props = {
  socket: Socket | null;
  conversationId: string | null;
  userId: string;
  peerName: string;
  peerAvatarUrl: string | null;
};

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export default function CallControls({
  socket,
  conversationId,
  userId,
  peerName,
  peerAvatarUrl,
}: Props) {
  const [call, setCall] = useState<CallInfo | null>(null);
  const [status, setStatus] = useState("");
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [hasAudioTrack, setHasAudioTrack] = useState(false);
  const [hasVideoTrack, setHasVideoTrack] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const callRef = useRef<CallInfo | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const mountedRef = useRef(true);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const setCurrentCall = useCallback((next: CallInfo | null) => {
    callRef.current = next;
    if (mountedRef.current) setCall(next);
  }, []);

  useEffect(() => {
    if (!call || call.type !== "video") return;

    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [call]);

  const cleanup = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteStreamRef.current = null;

    pendingIceRef.current = [];

    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    setMuted(false);
    setCameraOff(false);
  }, []);

  const finishLocal = useCallback(() => {
    cleanup();
    setCurrentCall(null);
    setStatus("");
  }, [cleanup, setCurrentCall]);

  const getLocalMedia = useCallback(async (type: CallType) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera and microphone require HTTPS or localhost.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: type === "video",
    });

    localStreamRef.current = stream;
    setHasVideoTrack(
      stream.getVideoTracks().some((track) => track.readyState === "live"),
    );
    setHasAudioTrack(
      stream.getAudioTracks().some((track) => track.readyState === "live"),
    );
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    const micSource = audioContext.createMediaStreamSource(stream);

    micSource.connect(analyser);

    const samples = new Uint8Array(analyser.fftSize);

    const checkMic = () => {
      analyser.getByteTimeDomainData(samples);

      const peak = Math.max(
        ...Array.from(samples, (sample) => Math.abs(sample - 128)),
      );

      console.log("[Call] Microphone signal peak:", peak);
    };

    setInterval(checkMic, 2000);

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      localVideoRef.current.muted = true;
    }

    return stream;
  }, []);

  const createPeer = useCallback(
    (callId: string) => {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      const timer = window.setInterval(async () => {
        const stats = await pc.getStats();

        stats.forEach((report) => {
          if (report.type === "inbound-rtp" && report.kind === "audio") {
            console.log("[Audio inbound]", {
              packetsReceived: report.packetsReceived,
              bytesReceived: report.bytesReceived,
              audioLevel: report.audioLevel,
            });
          }

          if (report.type === "outbound-rtp" && report.kind === "audio") {
            console.log("[Audio outbound]", {
              packetsSent: report.packetsSent,
              bytesSent: report.bytesSent,
              audioLevel: report.audioLevel,
            });
          }
        });
      }, 3000);
      pcRef.current = pc;
      remoteStreamRef.current = new MediaStream();

      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
      }

      pc.ontrack = (event) => {
        const stream = remoteStreamRef.current;
        if (!stream) return;

        for (const track of event.streams[0]?.getTracks() ?? [event.track]) {
          if (!stream.getTracks().some((item) => item.id === track.id)) {
            stream.addTrack(track);
          }
        }

        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
          void remoteAudioRef.current.play().catch(() => {
            setStatus("Tap the page to enable remote audio.");
          });
        }
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;

        socket?.emit("call:signal", {
          callId,
          kind: "ice",
          payload: event.candidate.toJSON(),
        });
      };

      pc.onconnectionstatechange = () => {
        pc.getStats().then((stats) => {
          stats.forEach((report) => {
            if (report.type === "inbound-rtp" && report.kind === "audio") {
              console.log("[Call] Incoming audio:", {
                packetsReceived: report.packetsReceived,
                bytesReceived: report.bytesReceived,
              });
            }

            if (report.type === "outbound-rtp" && report.kind === "audio") {
              console.log("[Call] Outgoing audio:", {
                packetsSent: report.packetsSent,
                bytesSent: report.bytesSent,
              });
            }
          });
        });
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          setStatus("Connection failed or closed.");
        } else if (pc.connectionState === "connected") {
          setStatus("Connected");
        }
      };

      return (window.clearInterval(timer), pc);
    },
    [socket],
  );

  const startCall = useCallback(
    async (type: CallType) => {
      if (!socket?.connected || !conversationId || callRef.current) {
        setStatus("Connect to chat and try again.");
        return;
      }

      setStatus("Requesting microphone/camera permission…");

      try {
        // Request permission before sending the call request.
        await getLocalMedia(type);

        socket.emit("call:start", { conversationId, type }, (result: Ack) => {
          if (!result.ok || !result.callId) {
            cleanup();
            setStatus(
              result.error === "USER_BUSY"
                ? "You or the other user is busy."
                : result.error === "USER_OFFLINE"
                  ? "The other user is offline."
                  : "Unable to start the call.",
            );
            return;
          }

          setCurrentCall({
            callId: result.callId,
            conversationId,
            type,
            callerId: userId,
          });
          setStatus("Calling…");
        });
      } catch {
        cleanup();
        setStatus("Microphone/camera permission was denied or unavailable.");
      }
    },
    [socket, conversationId, userId, cleanup, getLocalMedia, setCurrentCall],
  );

  const acceptCall = useCallback(async () => {
    const current = callRef.current;
    if (!socket || !current || current.callerId === userId) return;

    try {
      await getLocalMedia(current.type);

      socket.emit("call:accept", { callId: current.callId }, (result: Ack) => {
        if (!result.ok) {
          cleanup();
          setCurrentCall(null);
          setStatus("This call is no longer available.");
          return;
        }

        setStatus("Connecting…");
      });
    } catch {
      socket.emit("call:reject", { callId: current.callId });
      cleanup();
      setCurrentCall(null);
      setStatus("Microphone/camera permission is required.");
    }
  }, [socket, userId, getLocalMedia, cleanup, setCurrentCall]);

  const rejectCall = useCallback(() => {
    const current = callRef.current;
    if (current && socket) {
      socket.emit("call:reject", { callId: current.callId });
    }
    finishLocal();
  }, [socket, finishLocal]);

  const endCall = useCallback(() => {
    const current = callRef.current;
    if (current && socket) {
      socket.emit("call:end", { callId: current.callId });
    }
    finishLocal();
  }, [socket, finishLocal]);

  useEffect(() => {
    mountedRef.current = true;
    if (!socket) return;

    const onIncoming = (incoming: CallInfo) => {
      if (callRef.current) {
        socket.emit("call:reject", { callId: incoming.callId });
        return;
      }

      setCurrentCall(incoming);
      setStatus("Incoming call");
    };

    const onAccepted = async (accepted: CallInfo) => {
      const current = callRef.current;
      if (!current || current.callId !== accepted.callId) return;

      setStatus("Connecting…");

      // Caller creates the offer. Callee waits for it.
      if (current.callerId !== userId) return;

      try {
        const stream = localStreamRef.current;
        if (!stream) throw new Error("Local media is unavailable.");

        const pc = createPeer(current.callId);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socket.emit(
          "call:signal",
          {
            callId: current.callId,
            kind: "offer",
            payload: { type: "offer", sdp: offer.sdp },
          },
          (result: Ack) => {
            if (!result.ok) setStatus("Could not send call offer.");
          },
        );
      } catch {
        setStatus("Unable to establish the call.");
      }
    };

    const onSignal = async (event: SignalEvent) => {
      const current = callRef.current;
      if (!current || current.callId !== event.callId) return;

      try {
        let pc = pcRef.current;

        if (event.kind === "offer") {
          // Only the callee receives an offer.
          if (current.callerId === userId) return;

          const stream = localStreamRef.current;
          if (!stream) return;

          pc = createPeer(current.callId);
          stream.getTracks().forEach((track) => pc!.addTrack(track, stream));

          await pc.setRemoteDescription(
            event.payload as RTCSessionDescriptionInit,
          );

          for (const candidate of pendingIceRef.current) {
            await pc.addIceCandidate(candidate);
          }
          pendingIceRef.current = [];

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          socket.emit("call:signal", {
            callId: current.callId,
            kind: "answer",
            payload: { type: "answer", sdp: answer.sdp },
          });
          return;
        }

        if (!pc) return;

        if (event.kind === "answer") {
          if (current.callerId !== userId) return;
          await pc.setRemoteDescription(
            event.payload as RTCSessionDescriptionInit,
          );

          for (const candidate of pendingIceRef.current) {
            await pc.addIceCandidate(candidate);
          }
          pendingIceRef.current = [];
          return;
        }

        const candidate = event.payload as RTCIceCandidateInit;

        if (!pc.remoteDescription) {
          pendingIceRef.current.push(candidate);
        } else {
          await pc.addIceCandidate(candidate);
        }
      } catch {
        setStatus("A signaling error occurred. End the call and retry.");
      }
    };

    const onEnded = (event: { callId: string; reason?: string }) => {
      if (callRef.current?.callId !== event.callId) return;

      cleanup();
      setCurrentCall(null);
      setStatus(event.reason === "missed" ? "Call timed out." : "Call ended.");
    };

    socket.on("call:incoming", onIncoming);
    socket.on("call:accepted", onAccepted);
    socket.on("call:signal", onSignal);
    socket.on("call:ended", onEnded);

    return () => {
      socket.off("call:incoming", onIncoming);
      socket.off("call:accepted", onAccepted);
      socket.off("call:signal", onSignal);
      socket.off("call:ended", onEnded);
    };
  }, [socket, userId, createPeer, cleanup, setCurrentCall]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [cleanup]);

  function toggleMicrophone() {
    const tracks = localStreamRef.current?.getAudioTracks() ?? [];
    if (!tracks.length) return;

    const nextMuted = !muted;
    tracks.forEach((track) => {
      track.enabled = !nextMuted;
    });
    setMuted(nextMuted);
  }

  function toggleCamera() {
    const tracks = localStreamRef.current?.getVideoTracks() ?? [];
    if (!tracks.length) return;

    const nextOff = !cameraOff;
    tracks.forEach((track) => {
      track.enabled = !nextOff;
    });
    setCameraOff(nextOff);
  }

  const incoming =
    !!call && call.callerId !== userId && status === "Incoming call";

  return (
    <>
      <div className="call-start-controls">
        <button
          type="button"
          className="start-audio-call"
          disabled={!socket?.connected || !conversationId || !!call}
          onClick={() => void startCall("audio")}
          aria-label="Start audio call"
          title="Start audio call"
        >
          <span aria-hidden="true">☎</span>
          <span>Audio</span>
        </button>

        <button
          type="button"
          className="start-video-call"
          disabled={!socket?.connected || !conversationId || !!call}
          onClick={() => void startCall("video")}
          aria-label="Start video call"
          title="Start video call"
        >
          <span aria-hidden="true">▣</span>
          <span>Video</span>
        </button>
      </div>

      {!call && status && (
        <p className="call-status" role="status">
          {status}
        </p>
      )}

      {call && (
        <div
          className={`call-overlay ${incoming ? "incoming-call-overlay" : "active-call-overlay"} ${call.type === "video" ? "video-call-overlay" : "audio-call-overlay"}`}
          role="dialog"
          aria-modal="true"
          aria-label={incoming ? "Incoming call" : "Call in progress"}
        >
          <section className="call-panel">
            <audio
              ref={remoteAudioRef}
              autoPlay
              playsInline
              aria-label="Remote participant audio"
            />
            <header className="call-topbar">
              <span className="call-security-label">
                <span aria-hidden="true">●</span> Private call
              </span>

              <button
                type="button"
                className="call-close-button"
                onClick={endCall}
                aria-label="Close and end call"
                title="End call"
              >
                ×
              </button>
            </header>

            {call.type === "video" && !incoming ? (
              <div className="call-video-stage">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  aria-label="Remote participant video"
                  className="call-remote-video"
                />

                <div className="call-video-placeholder">
                  <div className="call-avatar">☎</div>
                  <p>Waiting for the other camera…</p>
                </div>

                <div className="call-local-video-wrap">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    aria-label="Your camera preview"
                    className="call-local-video"
                  />
                  <span>You</span>
                </div>

                <div className="call-video-info">
                  <strong>Video call</strong>
                  <span role="status">{status}</span>
                </div>
              </div>
            ) : (
              <div className="call-person-stage">
                <div
                  className={`call-avatar-ring ${incoming ? "ring-incoming" : ""}`}
                >
                  <div className="call-avatar">
                    {peerAvatarUrl ? (
                      <img src={peerAvatarUrl} alt={`${peerName} profile`} />
                    ) : (
                      <span>{peerName.slice(0, 1).toUpperCase()}</span>
                    )}
                  </div>
                </div>

                <h2>
                  {incoming
                    ? peerName
                    : call.type === "video"
                      ? "Video call"
                      : "Audio call"}
                </h2>
                <p className="call-person-subtitle">
                  {incoming ? `Incoming ${call.type} call…` : status}
                </p>

                {!incoming && (
                  <div className="call-wave" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                )}
              </div>
            )}

            {incoming ? (
              <div className="call-bottom-controls incoming-call-controls">
                <button
                  type="button"
                  className="call-action-button decline-call-button"
                  onClick={rejectCall}
                  aria-label="Decline incoming call"
                >
                  <span aria-hidden="true">☎</span>
                  <span>Decline</span>
                </button>

                <button
                  type="button"
                  className="call-action-button accept-call-button"
                  onClick={() => void acceptCall()}
                  aria-label="Accept incoming call"
                >
                  <span aria-hidden="true">☎</span>
                  <span>Accept</span>
                </button>
              </div>
            ) : (
              <div className="call-bottom-controls active-call-controls">
                <button
                  type="button"
                  className={`call-action-button secondary-call-button ${muted ? "control-active" : ""}`}
                  onClick={toggleMicrophone}
                  disabled={!hasVideoTrack}
                  aria-label={muted ? "Unmute microphone" : "Mute microphone"}
                >
                  <span aria-hidden="true">{muted ? "🔇" : "🎙"}</span>
                  <span>{muted ? "Unmute" : "Mute"}</span>
                </button>

                {call.type === "video" && (
                  <button
                    type="button"
                    className={`call-action-button secondary-call-button ${cameraOff ? "control-active" : ""}`}
                    onClick={toggleCamera}
                    disabled={!hasVideoTrack}
                    aria-label={
                      cameraOff ? "Turn camera on" : "Turn camera off"
                    }
                  >
                    <span aria-hidden="true">{cameraOff ? "▧" : "▣"}</span>
                    <span>{cameraOff ? "Camera on" : "Camera off"}</span>
                  </button>
                )}

                <button
                  type="button"
                  className="call-action-button decline-call-button end-call-button"
                  onClick={endCall}
                  aria-label="End call"
                >
                  <span aria-hidden="true">☎</span>
                  <span>End</span>
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
