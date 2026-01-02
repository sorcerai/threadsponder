import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
    LayoutDashboard,
    MessageSquare,
    Users,
    Activity,
    FileText,
    Settings,
    BarChart3,
    FileBarChart,
    Sliders,
    UserCog
} from 'lucide-react';

const params = [
    { href: "/", label: "Overview", icon: LayoutDashboard },
    { href: "/replies", label: "Replies", icon: MessageSquare },
    { href: "/analytics", label: "Analytics", icon: BarChart3 },
    { href: "/reports", label: "EOD Report", icon: FileBarChart },
    { href: "/finetune", label: "Fine Tune", icon: Sliders },
    { href: "/character", label: "Character", icon: UserCog },
    { href: "/friends", label: "Friends", icon: Users },
    { href: "/limits", label: "Limits", icon: Activity },
    { href: "/docs", label: "Docs", icon: FileText },
];

export function Sidebar() {
    const location = useLocation();

    return (
        <div className="h-full w-[240px] flex flex-col border-r border-white/5 bg-background">
            <div className="p-6 border-b border-white/5">
                <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded bg-orange-500 text-black flex items-center justify-center font-bold text-xs italic">
                        T
                    </div>
                    <span className="font-semibold text-sm tracking-tight text-white">Thread<span className="text-orange-500">fire</span></span>
                </div>
            </div>

            <nav className="flex-1 px-3 py-6 space-y-0.5">
                <div className="px-3 mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Platform
                </div>
                {params.map((item) => {
                    const Icon = item.icon;
                    const isActive = location.pathname === item.href;
                    return (
                        <Link
                            key={item.href}
                            to={item.href}
                            className={cn(
                                "group flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-all duration-200",
                                isActive
                                    ? "bg-orange-500/10 text-orange-500 border border-orange-500/20 shadow-[0_0_15px_rgba(249,115,22,0.1)]"
                                    : "text-muted-foreground hover:text-white hover:bg-white/5"
                            )}
                        >
                            <Icon className="w-4 h-4" />
                            {item.label}
                        </Link>
                    );
                })}
            </nav>

            <div className="p-4 border-t border-white/5">
                <button className="flex items-center gap-3 px-3 py-2 w-full text-sm font-medium text-muted-foreground hover:text-white hover:bg-white/5 rounded-md transition-colors">
                    <Settings className="w-4 h-4" />
                    Settings
                </button>
            </div>
        </div>
    );
}
