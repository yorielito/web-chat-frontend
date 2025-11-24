// src/App.jsx (CÓDIGO FINAL CON ELIMINAR MENSAJES)

import React, { useState, useEffect, useRef } from "react";
import { db } from "./firebaseConfig";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  doc,
  setDoc,
  serverTimestamp,
  deleteDoc,
} from "firebase/firestore";

const MESSAGE_COLLECTION = "messages";
const STATUS_COLLECTION = "status";

// DEFINICIÓN DE USUARIOS VÁLIDOS
const USUARIO_A = "Tati";
const USUARIO_B = "Ben";
const VALID_USERS = [USUARIO_A, USUARIO_B];
const NICKNAME_KEY = "chatAppNickname";

// Función para generar el ID de conversación
const getConversationId = (u1, u2) => {
  return [u1, u2].sort().join("_");
};

// Función de ayuda para formatear el Timestamp
const formatTimestamp = (timestamp) => {
  if (!timestamp) return "Enviando...";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
};

// ==========================================================
// COMPONENTE CORE DEL CHAT
// ==========================================================
function ChatCore({ nickname }) {
  // --- VARIABLES DINÁMICAS ---
  const currentUsername = nickname;
  const recipientName = currentUsername === USUARIO_A ? USUARIO_B : USUARIO_A;
  const conversationId = getConversationId(currentUsername, recipientName);

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [recipientLastRead, setRecipientLastRead] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);

  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);

  const [contextMenu, setContextMenu] = useState(null); // <-- NUEVO: Para el menú de click derecho

  const messagesEndRef = useRef(null);

  const scrollToBottom = () =>
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // ==========================================================
  // CIERRA EL MENÚ DE CONTEXTO AL HACER CLICK EN CUALQUIER LUGAR
  // ==========================================================
  useEffect(() => {
    const handleOutsideClick = () => setContextMenu(null);
    window.addEventListener("click", handleOutsideClick);
    return () => window.removeEventListener("click", handleOutsideClick);
  }, []);

  // ==========================================================
  // EFFECT 1: SUSCRIPCIONES (Mensajes y Estado de Lectura)
  // ==========================================================
  useEffect(() => {
    const qMessages = query(
      collection(db, MESSAGE_COLLECTION),
      where("conversationId", "==", conversationId),
      orderBy("timestamp", "asc")
    );

    const unsubscribeMessages = onSnapshot(qMessages, (snapshot) => {
      const newMessages = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // LÓGICA DE VIBRACIÓN
      const currentMessagesLength = messages.length;
      if (newMessages.length > currentMessagesLength) {
        const lastIncomingMessage = newMessages[newMessages.length - 1];
        if (lastIncomingMessage.author !== currentUsername) {
          if (navigator.vibrate) {
            navigator.vibrate(200);
          }
        }
      }

      setMessages(newMessages);
      updateLastRead(newMessages);
      setMessagesLoaded(true);
    });

    // Suscripción del Estado de Lectura del OTRO Usuario
    const statusDocRef = doc(db, STATUS_COLLECTION, conversationId);
    const recipientReadField = `${recipientName}_lastRead`;

    const unsubscribeStatus = onSnapshot(statusDocRef, (docSnapshot) => {
      if (docSnapshot.exists()) {
        setRecipientLastRead(docSnapshot.data()[recipientReadField] || null);
      }
      setStatusLoaded(true);
    });

    return () => {
      unsubscribeMessages();
      unsubscribeStatus();
    };
  }, [messages.length]);

  // ==========================================================
  // FUNCIÓN DE ELIMINACIÓN
  // ==========================================================
  const handleDeleteMessage = async (id) => {
    if (window.confirm("Möchten Sie diese Nachricht wirklich löschen?")) {
      try {
        // Elimina el documento de la base de datos
        await deleteDoc(doc(db, MESSAGE_COLLECTION, id));
        setContextMenu(null);
      } catch (error) {
        console.error("Error al eliminar mensaje:", error);
      }
    }
  };

  // ==========================================================
  // FUNCIÓN PARA MOSTRAR EL MENÚ DE CONTEXTO (CLICK DERECHO)
  // ==========================================================
  const handleContextMenu = (e, msg) => {
    e.preventDefault(); // Evita el menú de contexto del navegador

    // Solo puedes eliminar tus propios mensajes
    if (msg.author !== currentUsername) return;

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      id: msg.id,
    });
  };

  // ==========================================================
  // FUNCIÓN DE ACTUALIZACIÓN DE LECTURA
  // ==========================================================
  const updateLastRead = async (loadedMessages) => {
    if (loadedMessages.length === 0) return;
    const lastReadTimestamp =
      loadedMessages[loadedMessages.length - 1].timestamp;

    if (!lastReadTimestamp || !lastReadTimestamp.toDate) return;

    const userReadField = `${currentUsername}_lastRead`;

    try {
      await setDoc(
        doc(db, STATUS_COLLECTION, conversationId),
        {
          [userReadField]: lastReadTimestamp,
        },
        { merge: true }
      );
    } catch (error) {
      console.error("Error al actualizar estado de lectura:", error);
    }
  };

  // FUNCIÓN PARA SELECCIONAR MENSAJE A RESPONDER (Click-to-Reply)
  const handleSelectReply = (msg) => {
    setReplyingTo({
      id: msg.id,
      author: msg.author,
      text: msg.text.substring(0, 50) + (msg.text.length > 50 ? "..." : ""),
    });
  };

  // FUNCIÓN DE ENVÍO
  const sendMessage = async (e) => {
    e.preventDefault();
    if (message.trim()) {
      const msgData = {
        text: message,
        author: currentUsername,
        conversationId: conversationId,
        timestamp: serverTimestamp(),
      };

      if (replyingTo) {
        msgData.replyTo = replyingTo;
        setReplyingTo(null);
      }

      try {
        await addDoc(collection(db, MESSAGE_COLLECTION), msgData);
        setMessage("");
      } catch (error) {
        console.error("Error al enviar mensaje a Firestore:", error);
      }
    }
  };

  // CONTROL DE CARGA AL INICIO
  if (!messagesLoaded || !statusLoaded) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "50px",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <h2>Cargando Chat...</h2>
        <p>Estableciendo conexión en tiempo real con Firestore.</p>
      </div>
    );
  }

  // ==========================================================
  // RENDERIZADO
  // ==========================================================
  return (
    <div
      style={{
        padding: "20px",
        maxWidth: "800px",
        margin: "auto",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <button
        onClick={() => {
          localStorage.removeItem(NICKNAME_KEY);
          window.location.reload();
        }}
        style={{
          position: "absolute",
          top: "10px",
          right: "10px",
          padding: "8px 15px",
          backgroundColor: "#dc3545",
          color: "white",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
          zIndex: 10,
        }}
      >
        Nickname wechseln ({currentUsername})
      </button>
      <h2>Internal App</h2>
      <p style={{ marginTop: "10px", fontSize: "14px", textAlign: "center" }}>
        Du bist: <strong>{currentUsername}</strong> | Du schreibst mit:{" "}
        <strong>{recipientName}</strong>
      </p>

      {/* Área de Mensajes */}
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: "8px",
          height: "400px",
          overflowY: "auto",
          padding: "15px",
          marginBottom: "15px",
          backgroundColor: "#f9f9f9",
        }}
      >
        {messages.map((msg, index) => {
          const isMyMessage = msg.author === currentUsername;
          const isSeen =
            msg.timestamp &&
            recipientLastRead &&
            msg.timestamp.toDate() <= recipientLastRead.toDate();

          return (
            <div
              key={msg.id || index}
              style={{
                display: "flex",
                justifyContent: isMyMessage ? "flex-end" : "flex-start",
                marginBottom: "8px",
              }}
            >
              <div
                onClick={() => handleSelectReply(msg)}
                onContextMenu={(e) => handleContextMenu(e, msg)} // <-- Click Derecho para menú
                style={{
                  maxWidth: "70%",
                  padding: "8px 10px",
                  borderRadius: "10px",
                  cursor: "pointer",
                  backgroundColor: isMyMessage ? "#DCF8C6" : "#FFFFFF",
                  boxShadow: "0 1px 0.5px rgba(0, 0, 0, 0.13)",
                  wordBreak: "break-word",
                  borderLeft: msg.replyTo ? "4px solid #007bff" : "none",
                  opacity: msg.id === contextMenu?.id ? 0.8 : 1, // Leve opacidad si está en el menú
                }}
              >
                {/* CITA DE RESPUESTA */}
                {msg.replyTo && (
                  <div
                    style={{
                      marginBottom: "5px",
                      padding: "5px",
                      backgroundColor: isMyMessage ? "#c8e6a4" : "#f0f0f0",
                      borderRadius: "5px",
                      fontSize: "0.8em",
                      color: "#333",
                    }}
                  >
                    <strong style={{ color: "#007bff" }}>
                      {msg.replyTo.author}
                    </strong>
                    <p
                      style={{
                        margin: 0,
                        textOverflow: "ellipsis",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {msg.replyTo.text}
                    </p>
                  </div>
                )}

                {!isMyMessage && (
                  <strong
                    style={{
                      display: "block",
                      fontSize: "0.75em",
                      color: "#05625e",
                      marginBottom: "3px",
                    }}
                  >
                    {msg.author}
                  </strong>
                )}
                <p style={{ margin: 0, fontSize: "0.9em" }}>{msg.text}</p>
                <div
                  style={{
                    fontSize: "0.65em",
                    color: "#777",
                    marginTop: "5px",
                    textAlign: "right",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    minWidth: "50px",
                  }}
                >
                  {formatTimestamp(msg.timestamp)}
                  {isMyMessage && (
                    <span
                      style={{
                        marginLeft: "4px",
                        fontSize: "0.9em",
                        color: isSeen ? "#4FC3F7" : "#999",
                      }}
                    >
                      ✓{isSeen ? "✓" : ""}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* CAJA DE RESPUESTA SELECCIONADA */}
      {replyingTo && (
        <div
          style={{
            padding: "10px",
            marginBottom: "10px",
            borderLeft: "4px solid #007bff",
            backgroundColor: "#e9f7ff",
            borderRadius: "4px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ flexGrow: 1 }}>
            <strong style={{ color: "#007bff", fontSize: "0.9em" }}>
              Respondiendo a {replyingTo.author}:
            </strong>
            <p style={{ margin: 0, fontSize: "0.8em", color: "#555" }}>
              {replyingTo.text}
            </p>
          </div>
          <button
            onClick={() => setReplyingTo(null)}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.2em",
              cursor: "pointer",
              color: "#dc3545",
            }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Formulario de Mensaje */}
      <form onSubmit={sendMessage} style={{ display: "flex", gap: "10px" }}>
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Schreibe eine Nachricht..."
          style={{
            flexGrow: 1,
            padding: "12px",
            borderRadius: "6px",
            border: "1px solid #ccc",
          }}
          autoFocus
        />
        <button
          type="submit"
          style={{
            padding: "12px 20px",
            backgroundColor: "#007bff",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          Enviar
        </button>
      </form>

      {/* MENÚ DE CONTEXTO DE ELIMINACIÓN */}
      {contextMenu && (
        <div
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            backgroundColor: "#fff",
            borderRadius: "4px",
            boxShadow: "0 2px 5px rgba(0,0,0,0.2)",
            zIndex: 100,
            padding: "5px",
          }}
          onClick={(e) => e.stopPropagation()} // Detiene el click para que no cierre el menú inmediatamente
        >
          <button
            onClick={() => handleDeleteMessage(contextMenu.id)}
            style={{
              display: "block",
              width: "100%",
              padding: "8px 15px",
              border: "none",
              backgroundColor: "transparent",
              textAlign: "left",
              cursor: "pointer",
              color: "#dc3545",
              fontSize: "0.9em",
            }}
          >
            Löschen
          </button>
        </div>
      )}
    </div>
  );
}

// ==========================================================
// COMPONENTE WRAPPER PRINCIPAL (Selector de Nickname)
// ==========================================================
function NicknameSelector() {
  const [nickname, setNickname] = useState(null);
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const storedNickname = localStorage.getItem(NICKNAME_KEY);
    if (storedNickname && VALID_USERS.includes(storedNickname)) {
      setNickname(storedNickname);
    }
  }, []);

  const handleLogin = (e) => {
    e.preventDefault();
    const trimmedInput = inputValue.trim();
    setError("");

    if (!VALID_USERS.includes(trimmedInput)) {
      setError(`Falscher Nickname`);
      return;
    }

    localStorage.setItem(NICKNAME_KEY, trimmedInput);
    setNickname(trimmedInput);
  };

  if (nickname) {
    return <ChatCore nickname={nickname} />;
  }

  return (
    <div
      style={{
        padding: "40px",
        maxWidth: "400px",
        margin: "100px auto",
        border: "1px solid #ccc",
        borderRadius: "8px",
      }}
    >
      <h2>Schreib deine Nickname</h2>
      <form
        onSubmit={handleLogin}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={`Schreibe deine Nickname`}
          required
          style={{
            padding: "12px",
            borderRadius: "4px",
            border: "1px solid #ddd",
          }}
        />
        <button
          type="submit"
          style={{
            padding: "10px",
            backgroundColor: "#007bff",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Anmelden
        </button>
      </form>
      {error && (
        <p style={{ color: "red", marginTop: "10px", fontSize: "0.9em" }}>
          {error}
        </p>
      )}
    </div>
  );
}

export default NicknameSelector;
