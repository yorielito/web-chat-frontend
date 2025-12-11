// src/App.jsx (CÓDIGO COMPLETO FINAL Y CONSOLIDADO EN ALEMÁN)

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
// Importaciones consolidadas de firebaseConfig.js
import {
  db,
  storage,
  serverTimestamp,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  doc,
  setDoc,
  updateDoc,
  limit,
  startAfter,
  getDocs,
  ref, // Importado desde Storage
  uploadBytesResumable,
  getDownloadURL,
} from "./firebaseConfig";

// === CONSTANTES ===
const MESSAGE_COLLECTION = "messages";
const STATUS_COLLECTION = "status";
const TYPING_COLLECTION = "typingStatus";

const USUARIO_A = "Tati";
const USUARIO_B = "Ben";
const VALID_USERS = [USUARIO_A, USUARIO_B];
const NICKNAME_KEY = "chatAppNickname";

// EMOJIS DISPONIBLES
const AVAILABLE_EMOJIS = ["👍", "❤️", "😂", "🤯", "🙏"];
const MESSAGES_PER_PAGE = 20;

// === HELPERS ===
const getConversationId = (u1, u2) => {
  return [u1, u2].sort().join("_");
};

// Hilfsfunktion zur Formatierung des Zeitstempels (HH:MM)
const formatTimestamp = (timestamp) => {
  if (!timestamp) return "Senden...";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
};

// Datums-Trenner-Formatierung
const formatDateDivider = (timestamp) => {
  if (!timestamp) return null;
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const messageDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
  if (messageDate.getTime() === today.getTime()) {
    return "HEUTE";
  } else if (messageDate.getTime() === yesterday.getTime()) {
    return "GESTERN";
  } else {
    const options = { year: "numeric", month: "long", day: "numeric" };
    return date.toLocaleDateString("de-DE", options).toUpperCase();
  }
};

// ==========================================================
// CHAT-KERNKOMPONENTE (CHATCORE)
// ==========================================================
function ChatCore({ nickname }) {
  const currentUsername = nickname;
  const recipientName = currentUsername === USUARIO_A ? USUARIO_B : USUARIO_A;
  const conversationId = getConversationId(currentUsername, recipientName);

  // ESTADOS
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [replyingTo, setReplyingTo] = useState(null);

  const [isTyping, setIsTyping] = useState(false);
  const [recipientIsTyping, setRecipientIsTyping] = useState(false);

  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);

  const [contextMenu, setContextMenu] = useState(null);
  const [selectedMessageForMenu, setSelectedMessageForMenu] = useState(null);
  const [reactingToMessageId, setReactingToMessageId] = useState(null);

  // Paginierungs-Status
  const [oldestDocRef, setOldestDocRef] = useState(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [isPaginating, setIsPaginating] = useState(false);

  // Lesestatus-Status
  const [currentUserLastRead, setCurrentUserLastRead] = useState(null); // Lo que yo leí
  const [lastMyMessageSeen, setLastMyMessageSeen] = useState(null); // Lo que el otro leyó (para el doble check)

  // ESTADO PARA IMÁGENES (STORAGE)
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  // ESTADO PARA EL VISOR DE IMAGEN
  const [viewerImage, setViewerImage] = useState(null);

  // REFERENCIAS
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const typingTimeoutRef = useRef(null); // <-- Única referencia para el estado de escritura
  const readStatusTimeoutRef = useRef(null); // <-- NUEVA Referencia para el estado de lectura (fix scroll)
  const fileInputRef = useRef(null);
  const isInitialLoadRef = useRef(true); // Para el scroll inicial

  // HELPERS
  // Baja el scroll al final del chat (usado en el envío de nuevos mensajes o carga inicial)
  const scrollToBottom = useCallback(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop =
        messagesContainerRef.current.scrollHeight;
    }
  }, []);

  const keepScrollPosition = useCallback((oldScrollHeight) => {
    if (messagesContainerRef.current) {
      const newScrollHeight = messagesContainerRef.current.scrollHeight;
      const heightDifference = newScrollHeight - oldScrollHeight;
      messagesContainerRef.current.scrollTop = heightDifference;
    }
  }, []);

  // ÖFFNEN DES BILD-VIEWERS
  const openImageViewer = (imageUrl, imageCaption) => {
    setViewerImage({ url: imageUrl, caption: imageCaption });
  };

  // SCHLIESSEN DES BILD-VIEWERS
  const closeImageViewer = () => {
    setViewerImage(null);
  };

  // ==========================================================
  // FUNKTIONEN ZUR BEHANDLUNG VON AKTIONEN (AKTIONSHANDLER)
  // ==========================================================

  // UPDATE LAST READ
  const updateLastRead = useCallback(
    async (loadedMessages) => {
      if (loadedMessages.length === 0) return;

      // El timestamp del último mensaje visible/cargado
      const lastReadTimestamp =
        loadedMessages[loadedMessages.length - 1]?.timestamp;

      if (!lastReadTimestamp || !lastReadTimestamp.toDate) return;

      // Prevenir escrituras innecesarias
      if (
        currentUserLastRead &&
        lastReadTimestamp.toDate() <= currentUserLastRead.toDate()
      )
        return;

      const userReadField = `${currentUsername}_lastRead`;
      try {
        await setDoc(
          doc(db, STATUS_COLLECTION, conversationId),
          { [userReadField]: lastReadTimestamp },
          { merge: true }
        );
      } catch (error) {
        console.error("Fehler beim Aktualisieren des Lesestatus:", error);
      }
    },
    [conversationId, currentUsername, currentUserLastRead]
  );

  // PAGINIERUNG: LADEN ÄLTERER NACHRICHTEN
  const loadOlderMessages = useCallback(async () => {
    // Verificación CRÍTICA: Salir si no hay más, si ya está paginando, o si la referencia es nula
    if (!hasMoreMessages || isPaginating || !oldestDocRef?.id) return;

    setIsPaginating(true);

    const oldScrollHeight = messagesContainerRef.current.scrollHeight;

    // Consulta que inicia *después* del documento más antiguo conocido
    const qOlder = query(
      collection(db, MESSAGE_COLLECTION),
      where("conversationId", "==", conversationId),
      orderBy("timestamp", "desc"),
      startAfter(oldestDocRef),
      limit(MESSAGES_PER_PAGE)
    );

    try {
      const snapshot = await getDocs(qOlder);

      if (snapshot.empty) {
        setHasMoreMessages(false);
        return;
      }

      // 💡 Se establece el nuevo límite inferior (el documento más antiguo de esta nueva carga)
      const newOldestDocRef = snapshot.docs[snapshot.docs.length - 1];
      setOldestDocRef(newOldestDocRef);

      const olderMessages = snapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...doc.data(),
          docRef: doc,
        }))
        .reverse();

      // Agrega los mensajes antiguos *antes* de los mensajes existentes
      setMessages((prevMessages) => [...olderMessages, ...prevMessages]);

      if (snapshot.size < MESSAGES_PER_PAGE) {
        setHasMoreMessages(false);
      }

      // Restaura la posición del scroll después de que el DOM se actualice
      setTimeout(() => {
        keepScrollPosition(oldScrollHeight);
      }, 50);
    } catch (error) {
      console.error("Error al cargar mensajes antiguos:", error);
    } finally {
      setIsPaginating(false);
    }
  }, [
    conversationId,
    hasMoreMessages,
    isPaginating,
    oldestDocRef,
    keepScrollPosition,
  ]);
  // UPDATE TYPING STATUS
  const updateTypingStatus = useCallback(
    async (isUserTyping) => {
      const typingDocRef = doc(db, TYPING_COLLECTION, conversationId);
      const myTypingField = `${currentUsername}IsTyping`;

      try {
        // SIMPLIFICACIÓN: Enviamos el estado directamente a Firestore
        // Ya no necesitamos verificar if (isUserTyping !== isTyping)
        await setDoc(
          typingDocRef,
          { [myTypingField]: isUserTyping },
          { merge: true }
        );

        // Actualizamos el estado local después de la escritura exitosa
        setIsTyping(isUserTyping);
      } catch (error) {
        console.error("Fehler beim Aktualisieren des Zustands:", error);
      }
    },
    // CRUCIAL: Eliminamos 'isTyping' de las dependencias.
    // La función ahora solo depende de los IDs de la conversación.
    [conversationId, currentUsername]
  );

  // HANDLE MESSAGE CHANGE (TEXT INPUT) - Lógica de corrección aplicada
  const handleMessageChange = (e) => {
    const value = e.target.value;
    setMessage(value);

    // 1. LIMPIAR TEMPORIZADOR ANTERIOR (DE ESCRITURA)
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // 2. LÓGICA DE ACTIVACIÓN
    if (value.length > 0) {
      // Activar el estado de 'escribiendo' si el usuario no lo estaba
      if (!isTyping) {
        updateTypingStatus(true);
      }

      // 3. PROGRAMAR EL APAGADO AUTOMÁTICO
      typingTimeoutRef.current = setTimeout(() => {
        updateTypingStatus(false);
      }, 2000);
    } else {
      // LÓGICA DE DESACTIVACIÓN INMEDIATA (si el texto se borra completamente)
      updateTypingStatus(false);
    }
  };

  // HANDLE FILE CHANGE (IMAGE INPUT)
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      setReplyingTo(null);
      setMessage("");
    }
  };

  // SUBIR IMAGEN Y ENVIAR MENSAJE (STORAGE)
  const handleUploadAndSendMessage = async (e) => {
    e.preventDefault();
    if (selectedFile) {
      if (isTyping) {
        updateTypingStatus(false);
      }

      const fileRef = ref(
        storage,
        `images/${conversationId}/${Date.now()}_${selectedFile.name}`
      );
      const uploadTask = uploadBytesResumable(fileRef, selectedFile);

      uploadTask.on(
        "state_changed",
        (snapshot) => {
          const progress =
            (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(progress);
        },
        (error) => {
          console.error("Fehler beim Hochladen der Datei:", error);
          setSelectedFile(null);
          setUploadProgress(0);
          setMessage("");
          if (fileInputRef.current) fileInputRef.current.value = "";
        },
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          const msgData = {
            text: message.trim() || "",
            author: currentUsername,
            conversationId: conversationId,
            timestamp: serverTimestamp(),
            deleted: false,
            reactions: {},
            messageType: "image",
            imageUrl: downloadURL,
            imageFileName: selectedFile.name,
          };
          if (replyingTo) {
            msgData.replyTo = replyingTo;
            setReplyingTo(null);
          }
          try {
            await addDoc(collection(db, MESSAGE_COLLECTION), msgData);
            setTimeout(() => scrollToBottom("smooth"), 50);
          } catch (error) {
            console.error("Fehler beim Senden des Bildnachricht:", error);
          }

          setSelectedFile(null);
          setUploadProgress(0);
          setMessage("");
          if (fileInputRef.current) fileInputRef.current.value = "";
        }
      );
    } else {
      sendMessage(e);
    }
  };

  // SEND MESSAGE (TEXTO NORMAL)
  const sendMessage = async (e) => {
    e.preventDefault();
    if (message.trim()) {
      if (isTyping) {
        updateTypingStatus(false);
      }
      const msgData = {
        text: message,
        author: currentUsername,
        conversationId: conversationId,
        timestamp: serverTimestamp(),
        deleted: false,
        reactions: {},
        messageType: "text",
      };
      if (replyingTo) {
        msgData.replyTo = replyingTo;
        setReplyingTo(null);
      }
      try {
        await addDoc(collection(db, MESSAGE_COLLECTION), msgData);
        setMessage("");
        setTimeout(() => scrollToBottom("smooth"), 50);
      } catch (error) {
        console.error("Fehler beim Senden der Nachricht:", error);
      }
    }
  };

  // DELETE MESSAGE
  const handleDeleteMessage = async (id) => {
    if (
      window.confirm(
        "Bist du sicher, dass du diese Nachricht löschen möchtest?"
      )
    ) {
      try {
        await updateDoc(doc(db, MESSAGE_COLLECTION, id), { deleted: true });
        setContextMenu(null);
        setSelectedMessageForMenu(null);
        setReactingToMessageId(null);
      } catch (error) {
        console.error("Fehler beim Löschen der Nachricht:", error);
      }
    }
  };

  // CONTEXT MENU HANDLERS
  const handleContextMenu = (e, msg) => {
    e.preventDefault();
    if (msg.deleted) return;
    setContextMenu({ x: e.clientX, y: e.clientY, id: msg.id });
  };

  const handleMessageClick = (e, msg) => {
    if (msg.deleted) return;
    setReactingToMessageId(null);
    if (msg.author !== currentUsername) {
      handleSelectReply(msg);
      return;
    }
    if (selectedMessageForMenu && selectedMessageForMenu.id === msg.id) {
      setSelectedMessageForMenu(null);
    } else {
      e.stopPropagation();
      setSelectedMessageForMenu({ id: msg.id, ref: messagesEndRef.current });
    }
  };

  const handleOpenReactionMenu = (e, msgId) => {
    e.stopPropagation();
    setContextMenu(null);
    setSelectedMessageForMenu(null);
    setReactingToMessageId(reactingToMessageId === msgId ? null : msgId);
  };

  const handleReaction = async (messageId, emoji) => {
    const msgRef = doc(db, MESSAGE_COLLECTION, messageId);
    const messageToUpdate = messages.find((m) => m.id === messageId);
    if (!messageToUpdate) return;
    const reactions = messageToUpdate.reactions || {};
    const users = reactions[emoji] || [];
    let newUsers;
    if (users.includes(currentUsername)) {
      newUsers = users.filter((user) => user !== currentUsername);
    } else {
      newUsers = [...users, currentUsername];
    }
    const newReactions = { ...reactions, [emoji]: newUsers };
    if (newUsers.length === 0) {
      delete newReactions[emoji];
    }
    try {
      await updateDoc(msgRef, { reactions: newReactions });
      setReactingToMessageId(null);
    } catch (error) {
      console.error("Fehler beim Aktualisieren der Reaktion:", error);
    }
  };

  const handleSelectReply = (msg) => {
    if (msg.deleted) return;
    setReplyingTo({
      id: msg.id,
      author: msg.author,
      text:
        msg.messageType === "image" && !msg.text
          ? `[Bild: Kein Name]`
          : msg.text.substring(0, 50) + (msg.text.length > 50 ? "..." : ""),
    });
    setSelectedMessageForMenu(null);
    setReactingToMessageId(null);
  };

  // SCROLL-HANDLER FÜR PAGINIERUNG Y LECTURA
  //   const handleScroll = () => {
  //     if (messagesContainerRef.current) {
  //       const { scrollTop } = messagesContainerRef.current;

  //       // Activar la paginación si está cerca de la parte superior
  //       if (scrollTop < 10 && !isPaginating && hasMoreMessages) {
  //         loadOlderMessages();
  //       }
  //     }
  //     // Llamar a updateLastRead después de un breve delay
  //     // Usamos readStatusTimeoutRef para no interferir con el typingTimeoutRef
  //     clearTimeout(readStatusTimeoutRef.current);
  //     readStatusTimeoutRef.current = setTimeout(() => {
  //       updateLastRead(messages);
  //     }, 500);
  //   };

  const handleScroll = () => {
    if (messagesContainerRef.current) {
      const { scrollTop } = messagesContainerRef.current;

      // Cargar mensajes antiguos si el scroll está cerca de la parte superior (e.g., < 10px)
      if (scrollTop < 10 && !isPaginating && hasMoreMessages) {
        loadOlderMessages();
      }

      // Además, llama a la lógica de actualización de estado de lectura aquí
    }
  };

  // ==========================================================
  // EFFECTS (LISTENERS)
  // ==========================================================

  useEffect(() => {
    // 1. LISTENERS DE MENSAJES (FIRESTORE)
    const qMessages = query(
      collection(db, MESSAGE_COLLECTION),
      where("conversationId", "==", conversationId),
      orderBy("timestamp", "desc"),
      limit(MESSAGES_PER_PAGE)
    );

    const unsubscribeMessages = onSnapshot(
      qMessages,
      (snapshot) => {
        // 1. PREPARACIÓN DE MENSAJES Y SCROLL
        const currentMessages = snapshot.docs
          .map((doc) => ({
            id: doc.id,
            ...doc.data(),
            docRef: doc,
          }))
          .reverse();

        // Determinar si el usuario está cerca del final (para scroll automático)
        const isScrolledToBottom = messagesContainerRef.current
          ? messagesContainerRef.current.scrollHeight -
              messagesContainerRef.current.scrollTop -
              messagesContainerRef.current.clientHeight <
            100
          : true;

        // 2. CONFIGURACIÓN DEL PUNTO DE PAGINACIÓN MÁS ANTIGUO
        if (snapshot.docs.length > 0) {
          const docRefOfOldest = snapshot.docs[snapshot.docs.length - 1];
          setOldestDocRef(docRefOfOldest);
          setHasMoreMessages(snapshot.docs.length >= MESSAGES_PER_PAGE);
        } else {
          setHasMoreMessages(false);
        }

        // 3. ACTUALIZACIÓN DE ESTADOS
        setMessages(currentMessages);
        setMessagesLoaded(true);
        updateLastRead(currentMessages); // updateLastRead se llama aquí

        // 4. LÓGICA DE SCROLL ESTABLE (FIXED): Solo scroll si es carga inicial o mensaje del interlocutor

        // Determinar si el último mensaje en el snapshot proviene del interlocutor
        const lastMessageSender =
          currentMessages[currentMessages.length - 1]?.author;
        const isRecipientMessage = lastMessageSender === recipientName;

        if (isInitialLoadRef.current) {
          // Carga inicial: siempre va al final.
          isInitialLoadRef.current = false;
          setTimeout(() => scrollToBottom("auto"), 50);
        } else if (isRecipientMessage && isScrolledToBottom) {
          // 💡 FIX: Solo scroll si el mensaje es del interlocutor Y estábamos cerca del fondo.
          setTimeout(() => scrollToBottom("smooth"), 50);
        }
        // Si el mensaje es tuyo, se asume que el scroll fue manejado por la función sendMessage.
      },
      (error) => {
        // ✅ ERROR CALLBACK (TERCER ARGUMENTO)
        console.error("Firebase onSnapshot Error (Messages):", error);
        setMessagesLoaded(true);
      }
    );

    // 2. LISTENERS DE ESTADO DE LECTURA (FIRESTORE)
    const statusDocRef = doc(db, STATUS_COLLECTION, conversationId);
    const recipientReadField = `${recipientName}_lastRead`;
    const currentUserReadField = `${currentUsername}_lastRead`;

    const unsubscribeStatus = onSnapshot(
      statusDocRef,
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          setCurrentUserLastRead(data[currentUserReadField] || null);
          setLastMyMessageSeen(data[recipientReadField] || null);
        } else {
          setCurrentUserLastRead(null);
          setLastMyMessageSeen(null);
        }
        setStatusLoaded(true);
      },
      (error) => {
        console.error("Firebase onSnapshot Error (Status):", error);
        setStatusLoaded(true);
      }
    );

    return () => {
      unsubscribeMessages();
      unsubscribeStatus();
    };
  }, [
    conversationId,
    recipientName,
    currentUsername,
    // updateLastRead,
    // scrollToBottom,
  ]);

  // NEUER EFFEKT: Überprüft den Lesestatus des Empfängers
  const isMyLastMessageSeen = useMemo(() => {
    if (!lastMyMessageSeen || messages.length === 0) return false;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.author === currentUsername && msg.timestamp) {
        // Compara los timestamps
        return msg.timestamp.toDate() <= lastMyMessageSeen.toDate();
      }
    }
    return false;
  }, [messages, currentUsername, lastMyMessageSeen]);

  // NUEVO useEffect para estabilizar el Listener de Estado de Escritura
  useEffect(() => {
    const typingDocRef = doc(db, TYPING_COLLECTION, conversationId);

    // Usamos useMemo que definimos previamente para la estabilidad
    const recipientTypingField = `${recipientName}IsTyping`;

    const unsubscribeTyping = onSnapshot(typingDocRef, (docSnapshot) => {
      if (docSnapshot.exists()) {
        const isTyping = docSnapshot.data()[recipientTypingField] || false;
        setRecipientIsTyping(isTyping);
      } else {
        setRecipientIsTyping(false);
      }
    });

    // 💡 LA CLAVE: La función de retorno llama a la desuscripción.
    return () => {
      unsubscribeTyping();
    };

    // Solo se ejecuta si cambian estos valores estables.
  }, [conversationId, recipientName]);

  // LIMPIEZA DE TIMEOUTS (Se ejecuta al desmontar el componente)
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (readStatusTimeoutRef.current) {
        clearTimeout(readStatusTimeoutRef.current);
      }
      // Opcional: Desactivar el estado de escritura en Firestore si el componente se desmonta
      if (isTyping) {
        updateTypingStatus(false);
      }
    };
  }, [isTyping, updateTypingStatus]);

  // LADESTEUERUNG
  if (!messagesLoaded || !statusLoaded) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "50px",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <h2>Chat wird geladen...</h2>
        <p>Echtzeitverbindung mit Firestore wird hergestellt.</p>
      </div>
    );
  }

  // VARIABELN FÜR DEN DIVIDER
  let unreadDividerRendered = false;
  const shouldShowUnreadDivider = currentUserLastRead && messages.length > 0;

  // ==========================================================
  // RENDERING
  // ==========================================================
  return (
    <div
      style={{
        padding: "20px",
        maxWidth: "800px",
        margin: "auto",
        fontFamily: "Arial, sans-serif",
        position: "relative",
      }}
    >
      {/* Kopfzeile und Nickname-Schaltfläche */}
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
          fontSize: "0.85em",
        }}
      >
        Abmelden ({currentUsername})
      </button>
      <h2>1:1 Chat mit Firestore</h2>
      <p
        style={{
          marginTop: "10px",
          fontSize: "14px",
          textAlign: "center",
          marginBottom: "15px",
        }}
      >
        Du bist: <strong>{currentUsername}</strong> | Du sprichst mit:{" "}
        <strong>{recipientName}</strong>
      </p>

      {/* Nachrichtenbereich */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        style={{
          border: "1px solid #ddd",
          borderRadius: "8px",
          height: "400px",
          overflowY: "auto",
          padding: "15px",
          marginBottom: "15px",
          backgroundColor: "#f9f9f9",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* LADE-INDIKATOR FÜR SCROLL-INFINITO */}
        {isPaginating && (
          <div
            style={{ textAlign: "center", padding: "10px", color: "#007bff" }}
          >
            Ältere Nachrichten werden geladen...
          </div>
        )}

        {!hasMoreMessages && messages.length > 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "10px",
              color: "#777",
              fontSize: "0.8em",
            }}
          >
            Dies ist der Beginn deines Chats.
          </div>
        )}

        {messages.map((msg, index) => {
          const isMyMessage = msg.author === currentUsername;
          const isSeen = isMyMessage && isMyLastMessageSeen; // Solo mostramos 'Visto' en nuestro último mensaje

          const displayedText = msg.deleted ? "Nachricht gelöscht" : msg.text;
          const messageStyle = msg.deleted
            ? { fontStyle: "italic", color: "#777" }
            : {};
          const isSelected =
            selectedMessageForMenu && selectedMessageForMenu.id === msg.id;
          const showReactionMenu = reactingToMessageId === msg.id;
          const reactionsMap = msg.reactions || {};
          const isImage =
            msg.messageType === "image" && msg.imageUrl && !msg.deleted;

          // DIVIDER-LOGIK
          let unreadDivider = null;
          let dateDivider = null;

          // DATUMSTRENNER PRÜFUNG
          const previousMsg = messages[index - 1];
          if (
            msg.timestamp &&
            (!previousMsg ||
              !previousMsg.timestamp ||
              formatDateDivider(msg.timestamp) !==
                formatDateDivider(previousMsg.timestamp))
          ) {
            dateDivider = (
              <div
                key={`date-divider-${msg.id || index}`}
                style={{
                  textAlign: "center",
                  margin: "15px 0 5px 0",
                  width: "100%",
                }}
              >
                <span
                  style={{
                    padding: "4px 10px",
                    backgroundColor: "#e9ecef",
                    color: "#6c757d",
                    borderRadius: "12px",
                    fontSize: "0.75em",
                    fontWeight: "bold",
                  }}
                >
                  {formatDateDivider(msg.timestamp)}
                </span>
              </div>
            );
          }

          // UNGELESEN-TRENNER PRÜFUNG (MUSS NACH DATUMSTRENNER KOMMEN)
          if (
            shouldShowUnreadDivider &&
            !unreadDividerRendered &&
            msg.timestamp &&
            currentUserLastRead
          ) {
            const msgIsNewerThanLastRead =
              msg.timestamp.toDate() > currentUserLastRead.toDate();

            if (msgIsNewerThanLastRead) {
              unreadDividerRendered = true;
              unreadDivider = (
                <div
                  key="unread-divider"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    margin: "15px 0",
                    width: "100%",
                  }}
                >
                  <div
                    style={{
                      flexGrow: 1,
                      height: "1px",
                      backgroundColor: "#007bff44",
                    }}
                  ></div>
                  <span
                    style={{
                      margin: "0 10px",
                      padding: "4px 10px",
                      backgroundColor: "#007bff",
                      color: "white",
                      borderRadius: "12px",
                      fontSize: "0.75em",
                      fontWeight: "bold",
                      letterSpacing: "0.5px",
                    }}
                  >
                    NEUE NACHRICHTEN
                  </span>
                  <div
                    style={{
                      flexGrow: 1,
                      height: "1px",
                      backgroundColor: "#007bff44",
                    }}
                  ></div>
                </div>
              );
            }
          }

          // Rendert den Divider und dann die Nachricht.
          return (
            <React.Fragment key={msg.id || index}>
              {dateDivider}
              {unreadDivider}
              <div
                style={{
                  display: "flex",
                  justifyContent: isMyMessage ? "flex-end" : "flex-start",
                  marginBottom: "8px",
                  position: "relative",
                }}
              >
                <div
                  onClick={(e) => handleMessageClick(e, msg)}
                  onContextMenu={(e) => handleContextMenu(e, msg)}
                  style={{
                    maxWidth: isImage ? "50%" : "70%",
                    padding: isImage ? "5px" : "8px 10px",
                    borderRadius: "10px",
                    cursor: msg.deleted ? "default" : "pointer",
                    backgroundColor: isMyMessage
                      ? isImage
                        ? "transparent"
                        : "#DCF8C6"
                      : isImage
                      ? "transparent"
                      : "#FFFFFF",
                    boxShadow: isImage
                      ? "none"
                      : "0 1px 0.5px rgba(0, 0, 0, 0.13)",
                    wordBreak: "break-word",
                    borderLeft: msg.replyTo ? "4px solid #007bff" : "none",
                    opacity:
                      msg.id === contextMenu?.id ||
                      msg.deleted ||
                      isSelected ||
                      showReactionMenu
                        ? 0.8
                        : 1,
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  {/* ZITAT */}
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

                  {/* RENDERIZADO DE IMAGEN */}
                  {isImage ? (
                    <>
                      <img
                        src={msg.imageUrl}
                        alt={msg.text}
                        onClick={(e) => {
                          e.stopPropagation();
                          openImageViewer(msg.imageUrl, msg.text);
                        }}
                        style={{
                          maxWidth: "100%",
                          maxHeight: "300px",
                          borderRadius: "8px",
                          display: "block",
                          cursor: "zoom-in",
                          transition: "opacity 0.2s",
                        }}
                      />
                      {/* Etiqueta opcional para la imagen */}
                      {msg.text && (
                        <p
                          style={{
                            margin: "5px 0 0 0",
                            fontSize: "0.9em",
                            color: isMyMessage ? "#333" : "#555",
                          }}
                        >
                          {msg.text}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      {/* TEXTO NORMAL */}
                      {!isMyMessage && !msg.deleted && (
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
                      <p
                        style={{
                          margin: 0,
                          fontSize: "0.9em",
                          ...messageStyle,
                        }}
                      >
                        {displayedText}
                      </p>
                    </>
                  )}

                  {/* Timestamp */}
                  {!msg.deleted && (
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
                            color: isMyLastMessageSeen ? "#4FC3F7" : "#999",
                          }}
                        >
                          ✓{isMyLastMessageSeen ? "✓" : ""}
                        </span>
                      )}
                    </div>
                  )}

                  {/* REAKTIONEN */}
                  {Object.keys(reactionsMap).length > 0 && !msg.deleted && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: "-12px",
                        [isMyMessage ? "right" : "left"]: "0",
                        display: "flex",
                        zIndex: 10,
                      }}
                    >
                      {Object.entries(reactionsMap).map(
                        ([emoji, users]) =>
                          users.length > 0 && (
                            <div
                              key={emoji}
                              title={users.join(", ")}
                              onClick={() => handleReaction(msg.id, emoji)}
                              style={{
                                backgroundColor: "#fff",
                                borderRadius: "10px",
                                padding: "1px 5px",
                                fontSize: "0.7em",
                                marginRight: "2px",
                                cursor: "pointer",
                                boxShadow: "0 0 1px rgba(0,0,0,0.2)",
                                border: users.includes(currentUsername)
                                  ? "1px solid #007bff"
                                  : "1px solid #eee",
                              }}
                            >
                              {emoji} {users.length > 1 ? users.length : ""}
                            </div>
                          )
                      )}
                    </div>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}

        {/* INDICADOR DE ESCRITURA */}
        {recipientIsTyping && (
          <div
            style={{
              fontSize: "0.8em",
              color: "#777",
              padding: "5px",
              fontStyle: "italic",
            }}
          >
            {recipientName} schreibt...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* CAJA DE RESPUESTA */}
      {replyingTo && (
        <div
          style={{
            padding: "10px",
            marginBottom: "10px",
            borderLeft: "4px solid #007bff",
            backgroundColor: "#e6f0ff",
            borderRadius: "4px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ flexGrow: 1 }}>
            <strong style={{ color: "#007bff", display: "block" }}>
              Antwort an {replyingTo.author}
            </strong>
            <p style={{ margin: 0, fontSize: "0.9em", color: "#333" }}>
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
              padding: "0 5px",
            }}
          >
            &times;
          </button>
        </div>
      )}

      {/* VISTA PREVIA DEL ARCHIVO */}
      {selectedFile && (
        <div
          style={{
            padding: "10px",
            marginBottom: "10px",
            borderLeft: "4px solid #f0ad4e",
            backgroundColor: "#fff8e1",
            borderRadius: "4px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ flexGrow: 1, fontSize: "0.9em" }}>
            🖼️ Datei zum Senden bereit: **{selectedFile.name}**
            <p
              style={{ margin: "5px 0 0 0", fontSize: "0.8em", color: "#555" }}
            >
              {message
                ? "Mit Beschreibung"
                : "Fügen Sie eine Beschreibung hinzu (Optional)..."}
            </p>
          </div>
          <button
            onClick={() => {
              setSelectedFile(null);
              setUploadProgress(0);
              setMessage("");
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.2em",
              cursor: "pointer",
              color: "#dc3545",
              padding: "0 5px",
            }}
          >
            &times;
          </button>
        </div>
      )}

      {/* INDICADOR DE PROGRESO DE SUBIDA */}
      {uploadProgress > 0 && uploadProgress < 100 && (
        <div style={{ marginBottom: "10px" }}>
          <p
            style={{ margin: "0 0 5px 0", fontSize: "0.8em", color: "#007bff" }}
          >
            Wird hochgeladen... ({Math.round(uploadProgress)}%)
          </p>
          <div
            style={{
              height: "5px",
              backgroundColor: "#eee",
              borderRadius: "2px",
            }}
          >
            <div
              style={{
                width: `${uploadProgress}%`,
                height: "100%",
                backgroundColor: "#007bff",
                borderRadius: "2px",
                transition: "width 0.3s",
              }}
            ></div>
          </div>
        </div>
      )}

      {/* ESTADO DE LECTURA GLOBAL */}
      {isMyLastMessageSeen && (
        <div
          style={{
            textAlign: "right",
            color: "#4FC3F7",
            fontSize: "0.75em",
            marginBottom: "5px",
            fontWeight: "bold",
            textTransform: "uppercase",
          }}
        >
          Gesehen: ✓✓
        </div>
      )}

      {/* FORMULARIO DE MENSAJES */}
      <form
        onSubmit={handleUploadAndSendMessage}
        style={{
          display: "flex",
          gap: "10px",
          flexWrap: "wrap",
          width: "100%",
        }}
      >
        {/* BOTÓN DE SELECCIÓN DE ARCHIVOS */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/*"
          style={{ display: "none" }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current.click()}
          disabled={uploadProgress > 0}
          style={{
            padding: "12px 15px",
            backgroundColor: selectedFile ? "#f0ad4e" : "#F9F9F9",
            color: selectedFile ? "white" : "#777",
            border: "1px solid #ccc",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "1.1em",
            transition: "background-color 0.2s",
            lineHeight: 1,
          }}
          title="Bild senden"
        >
          📎
        </button>

        <input
          type="text"
          value={message}
          onChange={handleMessageChange}
          placeholder={
            selectedFile
              ? "Fügen Sie eine Beschreibung hinzu (Optional)"
              : "Schreibe deine Nachricht..."
          }
          style={{
            flexGrow: 1,
            padding: "12px",
            borderRadius: "6px",
            border: "1px solid #ccc",
            fontSize: "1em",
          }}
          autoFocus
          disabled={uploadProgress > 0}
        />

        <button
          type="submit"
          disabled={uploadProgress > 0 || (!message.trim() && !selectedFile)}
          style={{
            padding: "12px 20px",
            backgroundColor: "#007bff",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "1em",
            fontWeight: "bold",
            width: "100%",
          }}
        >
          {uploadProgress > 0 ? "Senden..." : "Senden"}
        </button>
      </form>

      {/* MENÚ CONTEXTUAL Y DE REACCIONES (Se renderiza al final para superponerse) */}
      {contextMenu && contextMenu.id && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 1000,
          }}
          onClick={() => setContextMenu(null)}
        >
          <div
            style={{
              position: "absolute",
              top: contextMenu.y,
              left: contextMenu.x,
              backgroundColor: "white",
              border: "1px solid #ccc",
              borderRadius: "4px",
              boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
              zIndex: 1001,
              minWidth: "150px",
            }}
          >
            <div
              onClick={(e) => {
                e.stopPropagation();
                handleSelectReply(
                  messages.find((m) => m.id === contextMenu.id)
                );
                setContextMenu(null);
              }}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                borderBottom: "1px solid #eee",
              }}
            >
              Antworten
            </div>
            <div
              onClick={(e) => {
                e.stopPropagation();
                handleOpenReactionMenu(e, contextMenu.id);
                setContextMenu(null);
              }}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                borderBottom: "1px solid #eee",
              }}
            >
              Reagieren
            </div>
            {messages.find((m) => m.id === contextMenu.id)?.author ===
              currentUsername && (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteMessage(contextMenu.id);
                }}
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  color: "#dc3545",
                }}
              >
                Löschen
              </div>
            )}
          </div>
        </div>
      )}

      {reactingToMessageId && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 1000,
          }}
          onClick={() => setReactingToMessageId(null)}
        >
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              backgroundColor: "white",
              border: "1px solid #ccc",
              borderRadius: "20px",
              boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
              zIndex: 1001,
              padding: "5px",
              display: "flex",
              gap: "5px",
            }}
          >
            {AVAILABLE_EMOJIS.map((emoji) => (
              <span
                key={emoji}
                onClick={(e) => {
                  e.stopPropagation();
                  handleReaction(reactingToMessageId, emoji);
                }}
                style={{ cursor: "pointer", fontSize: "1.5em", padding: "5px" }}
              >
                {emoji}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* VISOR DE IMÁGENES */}
      {viewerImage && (
        <div
          onClick={closeImageViewer}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.9)",
            zIndex: 2000,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            cursor: "zoom-out",
          }}
        >
          <button
            onClick={closeImageViewer}
            style={{
              position: "absolute",
              top: "20px",
              right: "20px",
              background: "none",
              border: "none",
              color: "white",
              fontSize: "2em",
              cursor: "pointer",
              zIndex: 2001,
            }}
          >
            &times;
          </button>

          <img
            src={viewerImage.url}
            alt={viewerImage.caption || "Bild aus dem Chat"}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "90%",
              maxHeight: "90%",
              objectFit: "contain",
              borderRadius: "8px",
              boxShadow: "0 0 20px rgba(0, 0, 0, 0.5)",
            }}
          />

          {viewerImage.caption && (
            <div
              style={{
                marginTop: "15px",
                padding: "10px 20px",
                backgroundColor: "rgba(0, 0, 0, 0.7)",
                color: "white",
                borderRadius: "8px",
                fontSize: "1.1em",
                maxWidth: "80%",
                textAlign: "center",
              }}
            >
              {viewerImage.caption}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ==========================================================
// COMPONENTE PRINCIPAL (INGRESAR NICKNAME)
// ==========================================================
function App() {
  const [selectedNickname, setSelectedNickname] = useState(
    localStorage.getItem(NICKNAME_KEY)
  );

  const [nicknameInput, setNicknameInput] = useState("");

  const handleInputNickname = (e) => {
    e.preventDefault();
    const trimmedNickname = nicknameInput.trim();

    if (VALID_USERS.includes(trimmedNickname)) {
      setSelectedNickname(trimmedNickname);
      localStorage.setItem(NICKNAME_KEY, trimmedNickname);
    } else {
      alert(`Ungültiger Nickname`);
    }
  };

  if (selectedNickname) {
    return <ChatCore nickname={selectedNickname} />;
  }

  // Interfaz de entrada simple
  return (
    <div
      style={{
        maxWidth: "400px",
        border: "1px solid #ddd",
        borderRadius: "8px",
        textAlign: "center",
        fontFamily: "Arial, sans-serif",
        height: "100vh",
        display: "flex",
        justifyContent: "center",
        flexDirection: "column",
      }}
    >
      <h1 style={{ fontSize: "1.5em" }}>Gib deinen Nickname ein</h1>

      <form
        onSubmit={handleInputNickname}
        style={{ marginTop: "20px", width: "100%" }}
      >
        <input
          type="password"
          value={nicknameInput}
          name="nickname"
          onChange={(e) => setNicknameInput(e.target.value)}
          placeholder={`Gib deinen Nickname ein`}
          style={{
            padding: "10px 0 10px 10px",
            borderRadius: "4px",
            marginBottom: "10px",
            border: "1px solid #ccc",
            width: "90%",
          }}
          required
        />
        <button
          type="submit"
          style={{
            padding: "10px 15px",
            backgroundColor: "#28a745",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            width: "90%",
            marginBottom: "20px",
          }}
        >
          Zum Chat
        </button>
      </form>
    </div>
  );
}

export default App;
