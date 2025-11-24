// src/App.jsx (CÓDIGO FINAL UNIFICADO CON NICKNAME PERSISTENTE)

import React, { useState, useEffect, useRef } from 'react';
import { db } from './firebaseConfig'; 
import { collection, query, where, orderBy, limit, onSnapshot, addDoc, doc, setDoc, serverTimestamp } from 'firebase/firestore'; 

const MESSAGE_COLLECTION = 'messages'; 
const STATUS_COLLECTION = 'status';

// DEFINICIÓN DE USUARIOS VÁLIDOS
const USUARIO_A = "Tati";
const USUARIO_B = 'Ben'; 
const VALID_USERS = [USUARIO_A, USUARIO_B];
const NICKNAME_KEY = 'chatAppNickname';

// Función para generar el ID de conversación (se mantiene igual)
const getConversationId = (u1, u2) => {
    return [u1, u2].sort().join('_');
};

// Función de ayuda para formatear el Timestamp
const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'Enviando...'; 
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
};

// ==========================================================
// COMPONENTE CORE DEL CHAT (Anteriormente la función Chat)
// ==========================================================
function ChatCore({ nickname }) { // <-- Acepta el nickname
    
    // --- VARIABLES DINÁMICAS ---
    const currentUsername = nickname; 
    const recipientName = (currentUsername === USUARIO_A) ? USUARIO_B : USUARIO_A;
    const conversationId = getConversationId(currentUsername, recipientName);
    
    const [message, setMessage] = useState('');
    const [messages, setMessages] = useState([]);
    const [recipientLastRead, setRecipientLastRead] = useState(null); 
    const messagesEndRef = useRef(null);
    
    const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

    useEffect(() => {
        scrollToBottom();
    }, [messages]);


    // [ RESTO DE LA LÓGICA useEffect, updateLastRead, sendMessage SE MANTIENEN IGUAL ]
    
    // ==========================================================
    // EFFECT 1: SUSCRIPCIONES (Mensajes y Estado de Lectura)
    // ==========================================================
    useEffect(() => {
        // --- 1. Suscripción de Mensajes ---
        const qMessages = query(
            collection(db, MESSAGE_COLLECTION),
            where('conversationId', '==', conversationId), 
            orderBy('timestamp', 'asc'),      
            limit(50)
        );

        const unsubscribeMessages = onSnapshot(qMessages, (snapshot) => {
            const newMessages = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setMessages(newMessages);
            updateLastRead(newMessages);
        });
        
        // --- 2. Suscripción del Estado de Lectura del OTRO Usuario ---
        const statusDocRef = doc(db, STATUS_COLLECTION, conversationId);
        const recipientReadField = `${recipientName}_lastRead`;

        const unsubscribeStatus = onSnapshot(statusDocRef, (docSnapshot) => {
            if (docSnapshot.exists()) {
                setRecipientLastRead(docSnapshot.data()[recipientReadField] || null);
            }
        });

        return () => {
            unsubscribeMessages(); 
            unsubscribeStatus();
        };

    }, []); 

    // ==========================================================
    // FUNCIÓN DE ACTUALIZACIÓN DE LECTURA 
    // ==========================================================
    const updateLastRead = async (loadedMessages) => {
        if (loadedMessages.length === 0) return;
        const lastReadTimestamp = loadedMessages[loadedMessages.length - 1].timestamp;

        if (!lastReadTimestamp || !lastReadTimestamp.toDate) return;
        
        const userReadField = `${currentUsername}_lastRead`;
        
        try {
            await setDoc(doc(db, STATUS_COLLECTION, conversationId), {
                [userReadField]: lastReadTimestamp
            }, { merge: true });
        } catch (error) {
             console.error("Error al actualizar estado de lectura:", error);
        }
    };


    // ==========================================================
    // FUNCIÓN DE ENVÍO
    // ==========================================================
    const sendMessage = async (e) => {
        e.preventDefault();
        if (message.trim()) {
            const msgData = {
                text: message,
                author: currentUsername,
                conversationId: conversationId, 
                timestamp: serverTimestamp() 
            };
            try {
                await addDoc(collection(db, MESSAGE_COLLECTION), msgData);
                setMessage('');
            } catch (error) {
                console.error("Error al enviar mensaje a Firestore:", error);
            }
        }
    };
    
    // [ RESTO DEL JSX DE RENDERIZADO SE MANTIENE IGUAL ]
    return (
        <div style={{ padding: '20px', maxWidth: '800px', margin: 'auto', fontFamily: 'Arial, sans-serif' }}>
            <button 
                onClick={() => { localStorage.removeItem(NICKNAME_KEY); window.location.reload(); }} // Función de Logout/Cambio
                style={{ position: 'absolute', top: '10px', right: '10px', padding: '8px 15px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >
               Nickname wechseln ({currentUsername})
            </button>
            <h2>Internal App</h2>
            <p style={{ marginTop: '10px', fontSize: '14px', textAlign: 'center' }}>
                Du bist: <strong>{currentUsername}</strong> | Du schreibst mit: <strong>{recipientName}</strong>
            </p>
            
            {/* Área de Mensajes */}
            <div style={{ border: '1px solid #ddd', borderRadius: '8px', height: '400px', overflowY: 'auto', padding: '15px', marginBottom: '15px', backgroundColor: '#f9f9f9' }}>
                {messages.map((msg, index) => {
                    const isMyMessage = msg.author === currentUsername;
                    const isSeen = msg.timestamp && recipientLastRead && msg.timestamp.toDate() <= recipientLastRead.toDate();

                    return (
                        <div 
                            key={msg.id || index} 
                            style={{ 
                                display: 'flex',
                                justifyContent: isMyMessage ? 'flex-end' : 'flex-start',
                                marginBottom: '8px'
                            }}
                        >
                            <div 
                                style={{
                                    maxWidth: '70%',
                                    padding: '8px 10px',
                                    borderRadius: '10px',
                                    backgroundColor: isMyMessage ? '#DCF8C6' : '#FFFFFF', 
                                    boxShadow: '0 1px 0.5px rgba(0, 0, 0, 0.13)',
                                    wordBreak: 'break-word'
                                }}
                            >
                                {!isMyMessage && (
                                    <strong style={{ display: 'block', fontSize: '0.75em', color: '#05625e', marginBottom: '3px' }}>
                                        {msg.author}
                                    </strong>
                                )}
                                <p style={{ margin: 0, fontSize: '0.9em' }}>{msg.text}</p>
                                <div style={{ 
                                    fontSize: '0.65em', 
                                    color: '#777', 
                                    marginTop: '5px', 
                                    textAlign: 'right', 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'flex-end',
                                    minWidth: '50px' 
                                }}>
                                    {formatTimestamp(msg.timestamp)}
                                    {isMyMessage && (
                                        <span 
                                            style={{ 
                                                marginLeft: '4px', 
                                                fontSize: '0.9em', 
                                                color: isSeen ? '#4FC3F7' : '#999' 
                                            }}
                                        >
                                            ✓{isSeen ? '✓' : ''} 
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>

            {/* Formulario de Mensaje */}
            <form onSubmit={sendMessage} style={{ display: 'flex', gap: '10px' }}>
                <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Escribe tu mensaje..."
                    style={{ flexGrow: 1, padding: '12px', borderRadius: '6px', border: '1px solid #ccc' }}
                    autoFocus
                />
                <button 
                    type="submit" 
                    style={{ 
                        padding: '12px 20px', 
                        backgroundColor: '#007bff', 
                        color: 'white', 
                        border: 'none', 
                        borderRadius: '6px', 
                        cursor: 'pointer'
                    }}
                >
                    Enviar
                </button>
            </form>
        </div>
    );
}

// ==========================================================
// COMPONENTE WRAPPER PRINCIPAL (El que se exporta)
// ==========================================================
function NicknameSelector() {
    const [nickname, setNickname] = useState(null);
    const [inputValue, setInputValue] = useState('');
    const [error, setError] = useState('');

    // Efecto para cargar el nickname de LocalStorage al inicio
    useEffect(() => {
        const storedNickname = localStorage.getItem(NICKNAME_KEY);
        if (storedNickname && VALID_USERS.includes(storedNickname)) {
            setNickname(storedNickname);
        }
    }, []);

    const handleLogin = (e) => {
        e.preventDefault();
        const trimmedInput = inputValue.trim();
        setError('');

        if (!VALID_USERS.includes(trimmedInput)) {
            setError(`Falscher Nickname`);
            return;
        }

        localStorage.setItem(NICKNAME_KEY, trimmedInput);
        setNickname(trimmedInput);
    };

    // Si tenemos un nickname, renderizamos el ChatCore
    if (nickname) {
        // Pasamos el nickname al componente de chat
        return <ChatCore nickname={nickname} />; 
    }

    // Si no tenemos nickname, mostramos el formulario de login
    return (
        <div style={{ padding: '40px', maxWidth: '400px', margin: '100px auto', border: '1px solid #ccc', borderRadius: '8px' }}>
            <h2>Dein Nickname</h2>
            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder={`Schreibe deine Nickname`}
                    required
                    style={{ padding: '12px', borderRadius: '4px', border: '1px solid #ddd' }}
                />
                <button type="submit" style={{ padding: '10px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                    Anmelden
                </button>
            </form>
            {error && <p style={{ color: 'red', marginTop: '10px', fontSize: '0.9em' }}>{error}</p>}
        </div>
    );
}

export default NicknameSelector;