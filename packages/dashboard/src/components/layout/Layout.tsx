import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useSocket } from '@/hooks/useSocket';

export function Layout() {
    const { isConnected } = useSocket();

    return (
        <div className="flex h-screen bg-background overflow-hidden relative">

            {/* Sidebar */}
            <Sidebar />

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col h-full overflow-hidden relative z-10">

                {/* Subtle Background Pattern */}
                <div className="absolute inset-0 pointer-events-none z-[-1] bg-dot-white [mask-image:radial-gradient(ellipse_at_center,black_50%,transparent_100%)] opacity-20" />

                {/* Header */}
                <header className="h-14 flex items-center justify-between px-8 border-b border-white/5 bg-background/50 backdrop-blur-sm">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">Overview</span>
                        <span>/</span>
                        <span>Dashboard</span>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className={`flex items-center gap-2 text-[10px] font-medium px-2 py-1 rounded-full border ${isConnected
                            ? 'bg-emerald-500/5 text-emerald-500 border-emerald-500/20'
                            : 'bg-red-500/5 text-red-500 border-red-500/20'
                            }`}
                        >
                            <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-red-500'}`} />
                            {isConnected ? 'Connected' : 'Disconnected'}
                        </div>
                    </div>
                </header>

                {/* Content Scroll Area */}
                <main className="flex-1 overflow-auto p-8">
                    <div className="max-w-6xl mx-auto">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    );
}
