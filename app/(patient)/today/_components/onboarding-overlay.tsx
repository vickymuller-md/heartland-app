'use client';

import { useState, useEffect } from 'react';
import { Heart, CalendarDays, ShieldCheck } from 'lucide-react';
import { markOnboardingSeen } from '@/lib/patient/onboarding-actions';

interface OnboardingOverlayProps {
  showOnboarding: boolean;
}

const SCREENS = [
  {
    title: 'Welcome to HEARTLAND',
    description:
      'HEARTLAND Protocol helps your care team monitor your heart failure and keep you safe between visits.',
    icon: Heart,
  },
  {
    title: 'Your Daily Routine',
    description:
      'Each day, log your weight, blood pressure, and how you\'re feeling. It only takes 2 minutes.',
    icon: CalendarDays,
  },
  {
    title: 'Your Data is Private',
    description:
      'Your health information is only shared with your linked provider. It is never sold or shared with anyone else.',
    icon: ShieldCheck,
  },
] as const;

export function OnboardingOverlay({ showOnboarding }: OnboardingOverlayProps) {
  const [currentScreen, setCurrentScreen] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Dual-persistence guard (pitfall 3): skip overlay if localStorage says already seen
    if (typeof window !== 'undefined') {
      const alreadySeen = localStorage.getItem('heartland_onboarding_seen');
      if (alreadySeen) {
        setVisible(false);
        return;
      }
    }
    setVisible(showOnboarding);
  }, [showOnboarding]);

  if (!visible) return null;

  const screen = SCREENS[currentScreen];
  const Icon = screen.icon;
  const isLastScreen = currentScreen === SCREENS.length - 1;

  function handleNext() {
    if (currentScreen < SCREENS.length - 1) {
      setCurrentScreen((prev) => prev + 1);
    }
  }

  function handleGetStarted() {
    markOnboardingSeen();
    if (typeof window !== 'undefined') {
      localStorage.setItem('heartland_onboarding_seen', '1');
    }
    setVisible(false);
  }

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center p-6">
      {/* Icon */}
      <div className="mb-6">
        <Icon className="w-16 h-16 text-blue-600" aria-hidden="true" />
      </div>

      {/* Title */}
      <h2 className="text-2xl font-bold text-gray-900 text-center mb-3">
        {screen.title}
      </h2>

      {/* Description */}
      <p className="text-lg text-gray-600 text-center max-w-sm mb-8">
        {screen.description}
      </p>

      {/* Dot progress indicator */}
      <div className="flex gap-3 mb-8" role="group" aria-label="Progress">
        {SCREENS.map((_, i) => (
          <span
            key={i}
            data-testid="progress-dot"
            className={`w-3 h-3 rounded-full ${
              i === currentScreen ? 'bg-blue-600' : 'bg-gray-300'
            }`}
            style={{ minWidth: 48, minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <span
              className={`block w-3 h-3 rounded-full ${
                i === currentScreen ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            />
          </span>
        ))}
      </div>

      {/* Action button */}
      {isLastScreen ? (
        <button
          onClick={handleGetStarted}
          className="w-full max-w-sm min-h-[48px] text-lg font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Get Started
        </button>
      ) : (
        <button
          onClick={handleNext}
          className="w-full max-w-sm min-h-[48px] text-lg font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Next
        </button>
      )}

      {/* Disclaimer on last screen */}
      {isLastScreen && (
        <p className="text-sm text-gray-500 text-center max-w-sm mt-4">
          This app is for healthcare professionals and their patients. It is not
          a substitute for medical care.
        </p>
      )}
    </div>
  );
}
