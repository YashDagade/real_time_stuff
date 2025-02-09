import React, { useState, useEffect, useRef } from "react";

/**
 * Realtime GPT-4o "Samantha" with function-calling and
 * continuing speech after a function call.
 */
export default function App() {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [messages, setMessages] = useState([]); // transcript array
  const [dataChannel, setDataChannel] = useState(null);

  const pcRef = useRef(null);
  const assistantAudioRef = useRef(null);

  // 1) Start session
  async function startSession() {
    if (isSessionActive) return;

    try {
      // 1) Get ephemeral token from your server
      const tokenResp = await fetch("http://localhost:3000/token");
      if (!tokenResp.ok) throw new Error("Failed to get ephemeral token");
      const sessionData = await tokenResp.json();
      const ephemeralKey = sessionData.client_secret.value;

      // 2) RTCPeerConnection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // 3) Audio element for Samantha
      assistantAudioRef.current = document.createElement("audio");
      assistantAudioRef.current.autoplay = true;
      pc.ontrack = (evt) => {
        assistantAudioRef.current.srcObject = evt.streams[0];
      };

      // 4) Capture mic
      const localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      pc.addTrack(localStream.getTracks()[0]);

      // 5) Data channel
      const dc = pc.createDataChannel("oai-events");
      setDataChannel(dc);

      // 6) Offer -> Realtime -> Answer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResp = await fetch(
        `https://api.openai.com/v1/realtime?model=${sessionData.model}`,
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
        }
      );
      if (!sdpResp.ok) throw new Error("Failed to get Realtime SDP answer");
      const answerSDP = await sdpResp.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSDP });
    } catch (err) {
      console.error("Error starting session:", err);
    }
  }

  // 2) Stop session (keep transcript)
  function stopSession() {
    if (dataChannel) dataChannel.close();
    if (pcRef.current) pcRef.current.close();
    setDataChannel(null);
    pcRef.current = null;
    setIsSessionActive(false);
  }

  // 3) Data channel events
  useEffect(() => {
    if (!dataChannel) return;

    function handleOpen() {
      setIsSessionActive(true);
      console.log("[DataChannel] open => session is active");

      // Tools + auto responses
      const sessionUpdate = {
        type: "session.update",
        session: {
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 800,
            create_response: true,
          },
          tools: [
            {
              type: "function",
              name: "getPatientSummary",
              description: "Retrieve a summary for a patient on a given date.",
              parameters: {
                type: "object",
                properties: {
                  patientId: { type: "number" },
                  date: { type: "string" },
                },
                required: ["patientId", "date"],
              },
            },
            {
              type: "function",
              name: "getClientSince",
              description: "Get the date a patient first joined the clinic.",
              parameters: {
                type: "object",
                properties: {
                  patientId: { type: "number" },
                },
                required: ["patientId"],
              },
            },
            {
              type: "function",
              name: "getTranscriptQuotes",
              description: "Retrieve quotes from transcripts for a query.",
              parameters: {
                type: "object",
                properties: {
                  patientId: { type: "number" },
                  query: { type: "string" },
                  date: { type: "string" },
                },
                required: ["patientId", "query"],
              },
            },
          ],
          tool_choice: "auto",
        },
      };
      dataChannel.send(JSON.stringify(sessionUpdate));
    }

    function handleMessage(e) {
      let evt;
      try {
        evt = JSON.parse(e.data);
      } catch {
        console.error("Error parsing event:", e.data);
        return;
      }
      console.log("[Realtime event]:", evt);

      // A) Therapist lines => your mic
      if (
        evt.type === "conversation.item.input_audio_transcription.completed"
      ) {
        const therapistText = evt.transcript;
        if (therapistText) {
          setMessages((prev) => [
            ...prev,
            { speaker: "Therapist", text: therapistText },
          ]);
        }
      }

      // B) Samantha lines => assistant audio transcript
      if (evt.type === "response.audio_transcript.done") {
        const samSpeech = evt.transcript;
        if (samSpeech) {
          setMessages((prev) => [
            ...prev,
            { speaker: "Samantha", text: samSpeech },
          ]);
        }
      }

      // C) On response.done, check for function calls
      if (evt.type === "response.done" && evt.response?.output) {
        evt.response.output.forEach((item) => {
          if (item.type === "function_call") {
            // parse name + arguments
            handleFunctionCall(item.name, item.arguments);
          }
        });
      }
    }

    dataChannel.addEventListener("open", handleOpen);
    dataChannel.addEventListener("message", handleMessage);

    return () => {
      dataChannel.removeEventListener("open", handleOpen);
      dataChannel.removeEventListener("message", handleMessage);
    };
  }, [dataChannel]);

  // 4) Handle function calls
  function handleFunctionCall(name, argStr) {
    let args = {};
    try {
      args = JSON.parse(argStr);
    } catch {}
    console.log(`[FunctionCall] ${name} =>`, args);

    // Show it in the transcript
    setMessages((prev) => [
      ...prev,
      { speaker: "Function", text: `Called ${name}(${JSON.stringify(args)})` },
    ]);

    // Placeholder results
    let result = "";
    switch (name) {
      case "getPatientSummary":
        result = `#summary for patient ${args.patientId} on ${args.date}`;
        break;
      case "getClientSince":
        result = `#patient ${args.patientId} joined on 2022-10-10 (placeholder)`;
        break;
      case "getTranscriptQuotes":
        result = `#quotes for patient ${args.patientId}, query="${args.query}"${
          args.date ? `, date=${args.date}` : ""
        }`;
        break;
      default:
        result = "#unknown function???";
    }

    // Show function result in the transcript too
    setMessages((prev) => [
      ...prev,
      { speaker: "Function", text: `Result: ${result}` },
    ]);

    // Send function_call_result to the model
    const fnEvent = {
      type: "conversation.item.create",
      item: {
        type: "function_call_result",
        role: "function",
        name,
        content: [
          {
            type: "function_result",
            text: JSON.stringify({ result }),
          },
        ],
      },
    };
    if (dataChannel) {
      dataChannel.send(JSON.stringify(fnEvent));

      // **IMPORTANT**: Ask the model to continue responding after the function
      setTimeout(() => {
        dataChannel.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions: "Please continue with your response.",
            },
          })
        );
      }, 500);
    }
  }

  // RENDER
  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: "bold" }}>
        Samantha Realtime Demo (with Function Calls)
      </h1>

      {isSessionActive ? (
        <button onClick={stopSession} style={{ marginRight: 8 }}>
          Stop Session
        </button>
      ) : (
        <button onClick={startSession} style={{ marginRight: 8 }}>
          Start Session
        </button>
      )}

      <div
        style={{
          marginTop: 16,
          border: "1px solid #ccc",
          minHeight: 200,
          padding: 8,
        }}
      >
        {messages.length === 0 ? (
          <p style={{ color: "#999" }}>No conversation yet.</p>
        ) : (
          messages.map((m, idx) => (
            <div key={idx} style={{ marginBottom: 8 }}>
              <strong>{m.speaker}:</strong> {m.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
