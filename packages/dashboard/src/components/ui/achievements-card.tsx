'use client';

import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import html2canvas from 'html2canvas';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trophy,
  Clock,
  MessageSquare,
  Flame,
  Shield,
  Download,
  X,
  Zap,
  TrendingUp,
} from 'lucide-react';
import { useAchievements } from '../../hooks/useStats';
import { cn } from '../../lib/utils';

interface AchievementsCardProps {
  className?: string;
}

export function AchievementsCard({ className }: AchievementsCardProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const { data: stats, isLoading, error } = useAchievements();

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSaveImage = async () => {
    if (!cardRef.current) return;

    setSaving(true);
    try {
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: null,
        scale: 2,
        logging: false,
        useCORS: true,
      });

      const link = document.createElement('a');
      link.download = `threadfire-achievements-${new Date().toISOString().split('T')[0]}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Failed to save image:', err);
    } finally {
      setSaving(false);
    }
  };

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    if (open) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [open]);

  const modal = (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className={cn('relative max-w-md w-full', className)}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setOpen(false)}
              className="absolute -top-2 -right-2 z-10 p-2 bg-zinc-800 hover:bg-zinc-700 rounded-full text-white shadow-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Save button */}
            <button
              onClick={handleSaveImage}
              disabled={saving || isLoading}
              className="absolute -top-2 -left-2 z-10 flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-full text-white text-sm font-medium shadow-lg transition-colors disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save'}
            </button>

            {/* The shareable card */}
            <div
              ref={cardRef}
              className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 p-6 shadow-2xl border border-zinc-700/50"
            >
              {/* Decorative gradient orbs */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/20 rounded-full blur-3xl" />
              <div className="absolute bottom-0 left-0 w-24 h-24 bg-orange-500/20 rounded-full blur-3xl" />

              {/* Header */}
              <div className="relative flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl shadow-lg">
                    <Shield className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">ThreadFire</h2>
                    <p className="text-xs text-zinc-400">Hater Defense Stats</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-zinc-500">
                    {new Date().toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </div>
                </div>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : error ? (
                <div className="text-center py-8 text-red-400">
                  Failed to load achievements
                </div>
              ) : stats ? (
                <>
                  {/* Streak highlight */}
                  <div className="relative mb-6 p-4 bg-gradient-to-r from-amber-500/10 to-orange-500/10 rounded-xl border border-amber-500/20">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-500/20 rounded-lg">
                          <Flame className="w-6 h-6 text-orange-400" />
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-white">
                            {stats.streak.current} day{stats.streak.current !== 1 ? 's' : ''}
                          </div>
                          <div className="text-xs text-zinc-400">Current streak</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-zinc-400">Best</div>
                        <div className="text-lg font-semibold text-amber-400">
                          {stats.streak.best} days
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Today's stats */}
                  <div className="mb-4">
                    <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
                      Today
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <StatBox
                        icon={<Zap className="w-4 h-4" />}
                        value={stats.today.hatersHandled}
                        label="Haters Handled"
                        color="amber"
                      />
                      <StatBox
                        icon={<Clock className="w-4 h-4" />}
                        value={`${stats.today.minutesSaved}m`}
                        label="Time Saved"
                        color="green"
                      />
                      <StatBox
                        icon={<MessageSquare className="w-4 h-4" />}
                        value={stats.today.wordsSaved}
                        label="Words Saved"
                        color="blue"
                      />
                      <StatBox
                        icon={<Shield className="w-4 h-4" />}
                        value={stats.today.hostileWordsDeflected}
                        label="Words Deflected"
                        color="purple"
                      />
                    </div>
                  </div>

                  {/* All-time stats */}
                  <div className="mb-4">
                    <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
                      All Time
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <StatBox
                        icon={<Trophy className="w-4 h-4" />}
                        value={stats.allTime.hatersHandled}
                        label="Total Handled"
                        color="amber"
                        large
                      />
                      <StatBox
                        icon={<TrendingUp className="w-4 h-4" />}
                        value={formatTime(stats.allTime.minutesSaved)}
                        label="Total Time Saved"
                        color="green"
                        large
                      />
                    </div>
                  </div>

                  {/* Footer branding */}
                  <div className="flex items-center justify-between pt-4 border-t border-zinc-700/50">
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <Shield className="w-3.5 h-3.5" />
                      threadfire.app
                    </div>
                    <div className="text-xs text-zinc-600">
                      Powered by AI
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-lg font-medium transition-all shadow-lg hover:shadow-xl text-sm"
      >
        <Trophy className="w-4 h-4" />
        Achievements
      </button>

      {/* Portal modal */}
      {mounted && createPortal(modal, document.body)}
    </>
  );
}

interface StatBoxProps {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  color: 'amber' | 'green' | 'blue' | 'purple';
  large?: boolean;
}

function StatBox({ icon, value, label, color, large }: StatBoxProps) {
  const colorClasses = {
    amber: 'from-amber-500/20 to-amber-500/5 text-amber-400 border-amber-500/20',
    green: 'from-emerald-500/20 to-emerald-500/5 text-emerald-400 border-emerald-500/20',
    blue: 'from-blue-500/20 to-blue-500/5 text-blue-400 border-blue-500/20',
    purple: 'from-purple-500/20 to-purple-500/5 text-purple-400 border-purple-500/20',
  };

  return (
    <div className={cn(
      'relative p-3 rounded-xl bg-gradient-to-br border',
      colorClasses[color]
    )}>
      <div className="flex items-start justify-between mb-1">
        <div className="p-1.5 rounded-lg bg-zinc-800/50">
          {icon}
        </div>
      </div>
      <div className={cn(
        'font-bold text-white',
        large ? 'text-xl' : 'text-lg'
      )}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className="text-xs text-zinc-400">{label}</div>
    </div>
  );
}

function formatTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

export default AchievementsCard;
