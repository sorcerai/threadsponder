/**
 * useSocket Hook - Disabled for Serverless Deployment
 *
 * Socket.io has been removed for Netlify Functions compatibility.
 * The dashboard now uses React Query polling fallback (refetchInterval: 60000).
 *
 * This hook returns a mock socket that does nothing, so existing code
 * that calls socket.on() or socket.emit() won't crash.
 */

// Create a no-op mock socket that matches the Socket interface
interface MockSocket {
    on: (...args: unknown[]) => MockSocket;
    off: (...args: unknown[]) => MockSocket;
    emit: (...args: unknown[]) => MockSocket;
    connect: (...args: unknown[]) => MockSocket;
    disconnect: (...args: unknown[]) => MockSocket;
    connected: boolean;
    id: string | undefined;
}

const mockSocket: MockSocket = {
    on: () => mockSocket,
    off: () => mockSocket,
    emit: () => mockSocket,
    connect: () => mockSocket,
    disconnect: () => mockSocket,
    connected: false,
    id: undefined,
};

export function useSocket() {
    // Return mock socket - real-time updates disabled for serverless
    // Dashboard uses React Query polling (60s intervals) instead
    return {
        socket: mockSocket,
        isConnected: false
    };
}

// Original implementation (kept for reference if needed for self-hosted version):
//
// import { useEffect, useRef, useState } from 'react';
// import { io, Socket } from 'socket.io-client';
//
// export function useSocket() {
//     const socketRef = useRef<Socket | null>(null);
//     const [isConnected, setIsConnected] = useState(false);
//
//     useEffect(() => {
//         const socket = io('/', {
//             path: '/socket.io',
//             transports: ['websocket', 'polling'],
//         });
//
//         socketRef.current = socket;
//
//         socket.on('connect', () => {
//             console.log('Socket connected');
//             setIsConnected(true);
//         });
//
//         socket.on('disconnect', () => {
//             console.log('Socket disconnected');
//             setIsConnected(false);
//         });
//
//         return () => {
//             socket.disconnect();
//         };
//     }, []);
//
//     return { socket: socketRef.current, isConnected };
// }
