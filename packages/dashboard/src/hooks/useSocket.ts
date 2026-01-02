import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

export function useSocket() {
    const socketRef = useRef<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        // Determine URL based on environment
        // In dev: proxy handles it (relative path)
        // In prod: relative path works too if served from same origin
        const socket = io('/', {
            path: '/socket.io',
            transports: ['websocket', 'polling'], // Try websocket first
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            console.log('Socket connected');
            setIsConnected(true);
        });

        socket.on('disconnect', () => {
            console.log('Socket disconnected');
            setIsConnected(false);
        });

        return () => {
            socket.disconnect();
        };
    }, []);

    return { socket: socketRef.current, isConnected };
}
