import { SignIn } from '@clerk/clerk-react';

export default function Login() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background bg-dot-white/[0.2] overflow-hidden relative">
        <div className="absolute inset-0 pointer-events-none z-0 bg-background [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)]" />
      <SignIn routing="path" path="/login" />
    </div>
  );
}
