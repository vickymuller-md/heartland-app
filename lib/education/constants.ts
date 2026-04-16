/**
 * HEARTLAND Patient Education -- All 8 Domain Constants
 *
 * Source: HEARTLAND Protocol v3.3, Module 4 (Teach-Back Domains)
 * Clinical content sourced from protocol Sections 4.3, 5.1, and 5.2.
 *
 * 3 Core Domains (Tier 1 -- all patients):
 *   daily_weight, medications, warning_signs
 *
 * 5 Extended Domains (Tier 2/3 only):
 *   what_is_hf, sodium_restriction, fluid_management, when_to_call, activity_guidance
 */

import type { EducationDomain } from './types';

export const EDUCATION_DOMAINS: EducationDomain[] = [
  // ───────────────────────────────────────────────
  // CORE DOMAINS (Tier 1 -- Required for All)
  // ───────────────────────────────────────────────
  {
    id: 'daily_weight',
    title: 'Daily Weight Monitoring',
    tier: 'core',
    icon: 'Scale',
    content: {
      common: [
        'Weighing yourself every day is one of the most important things you can do to manage your heart failure. Weight gain often means your body is holding extra fluid, which can be dangerous.',
        'Weigh yourself at the same time each day, preferably in the morning after using the bathroom and before eating. Wear similar clothing each time.',
        'Call your clinic the SAME DAY if you gain 3 or more pounds in 2 days. Seek urgent evaluation if you gain 5 or more pounds in 1 week.',
      ],
      track_a: [
        'Using the HEARTLAND app, enter your weight on the "Today" tab each morning. The app will automatically check for concerning weight changes and alert you if action is needed.',
      ],
      track_b: [
        'Write your weight in your paper diary each morning. Compare today\'s weight with yesterday\'s and with your weight from 7 days ago. If you see a gain of 3+ pounds in 2 days or 5+ pounds in a week, call your clinic.',
      ],
    },
    question: {
      text: 'When should you call your clinic about weight gain?',
      options: [
        'If I gain 1 pound in a week',
        'If I gain 3 or more pounds in 2 days',
        'Only if I gain 10 pounds',
        'Weight changes do not matter',
      ],
      correctIndex: 1,
      explanation:
        'A weight gain of 3 or more pounds in 2 days may mean your body is holding extra fluid. Call your clinic the same day so they can adjust your treatment.',
    },
  },
  {
    id: 'medications',
    title: 'Taking Your Heart Medications',
    tier: 'core',
    icon: 'Pill',
    content: {
      common: [
        'Your heart failure medications help your heart pump better and prevent fluid buildup. It is very important to take them every day, even when you feel well.',
        'Never stop taking your heart medications without talking to your doctor first. Stopping suddenly can make your heart failure worse.',
        'If you have trouble affording your medications, ask about generic options. A combination of generic medications can cost as little as $15 per month.',
      ],
      track_a: [
        'Use the Medications tab in the HEARTLAND app to track your daily doses. You can set reminders so you never miss a dose.',
      ],
      track_b: [
        'Check off each medication in your paper diary after you take it. Keep your diary near where you store your medications as a reminder.',
      ],
    },
    question: {
      text: 'What should you do if you feel well and want to stop your heart medication?',
      options: [
        'Stop taking it since you feel better',
        'Take it every other day instead',
        'Never stop without talking to your doctor first',
        'Only take it when you feel sick',
      ],
      correctIndex: 2,
      explanation:
        "Heart failure medications work to keep you feeling well. Stopping them without your doctor's guidance can cause your condition to worsen, even if you currently feel fine.",
    },
  },
  {
    id: 'warning_signs',
    title: 'Warning Signs to Watch For',
    tier: 'core',
    icon: 'AlertTriangle',
    content: {
      common: [
        'Knowing the warning signs of worsening heart failure can help you get help quickly and avoid a hospital visit.',
        'Call your clinic if you notice: shortness of breath that is new or getting worse, swelling in your ankles, feet, or belly, or waking up at night unable to breathe.',
        'Call 911 immediately if you have: chest pain, fainting or near-fainting, or severe shortness of breath at rest.',
      ],
      track_a: [
        'The HEARTLAND app checks your daily entries for warning signs automatically. If a red flag is detected, you will see an alert with instructions on what to do next.',
      ],
      track_b: [
        'Review your paper diary entries each day for warning signs. If you notice any of the symptoms listed above, do not wait -- call your clinic or 911 as directed.',
      ],
    },
    question: {
      text: 'What should you do if you have chest pain?',
      options: [
        'Wait to see if it goes away',
        'Call your clinic during business hours',
        'Call 911 immediately',
        'Take an extra dose of your medication',
      ],
      correctIndex: 2,
      explanation:
        'Chest pain is an EMERGENCY. Call 911 immediately. Do not wait or try to treat it yourself.',
    },
  },

  // ───────────────────────────────────────────────
  // EXTENDED DOMAINS (Tier 2/3 -- 5 additional)
  // Source: Protocol v3.3 Module 4 Section 4.3
  // ───────────────────────────────────────────────
  {
    id: 'what_is_hf',
    title: 'Understanding Heart Failure',
    tier: 'extended',
    icon: 'Heart',
    content: {
      common: [
        'Heart failure does not mean your heart has stopped working. It means your heart muscle is weakened and cannot pump blood as well as it should.',
        'There are different types of heart failure. In some cases the heart muscle is too weak to pump effectively (called HFrEF). In other cases the heart muscle is stiff and cannot fill properly (called HFpEF). Your doctor can tell you which type you have.',
        'Heart failure is a long-term condition, but with the right medications, monitoring, and lifestyle changes, many people live active and fulfilling lives.',
      ],
      track_a: [
        'The HEARTLAND app helps you stay on top of your heart failure management by tracking your daily vitals, medications, and symptoms all in one place.',
      ],
      track_b: [
        'Your paper diary is your personal health record. Writing down your daily information helps you and your doctor work together to manage your heart failure.',
      ],
    },
    question: {
      text: 'What does heart failure mean?',
      options: [
        'Your heart has completely stopped working',
        'Your heart is not pumping as well as it should',
        'You need a heart transplant right away',
        'Your heart beats too fast',
      ],
      correctIndex: 1,
      explanation:
        'Heart failure means your heart is not pumping as well as it should. It does not mean your heart has stopped. With proper treatment and monitoring, you can manage this condition effectively.',
    },
  },
  {
    id: 'sodium_restriction',
    title: 'Sodium (Salt) Restriction',
    tier: 'extended',
    icon: 'UtensilsCrossed',
    content: {
      common: [
        'Eating too much sodium (salt) causes your body to hold extra fluid, which makes your heart work harder. Your target is less than 2,000 milligrams (mg) of sodium per day.',
        'Read food labels carefully. Look for the sodium content per serving. Many processed and canned foods have very high sodium -- canned soups, deli meats, frozen meals, and snack foods are common sources.',
        'Use herbs, spices, lemon juice, or vinegar to flavor your food instead of salt. Cooking at home gives you more control over how much sodium you eat.',
      ],
      track_a: [
        'Use the HEARTLAND app to learn about low-sodium food choices. The app can help you keep track of your dietary goals alongside your other health metrics.',
      ],
      track_b: [
        'Write down what you eat in your paper diary. Note any high-sodium foods to discuss with your doctor or dietitian at your next visit.',
      ],
    },
    question: {
      text: 'How much sodium should you have each day?',
      options: [
        'As much as you want, sodium does not matter',
        'Less than 5,000 mg per day',
        'Less than 2,000 mg per day',
        'You should eat no sodium at all',
      ],
      correctIndex: 2,
      explanation:
        'Your daily sodium target is less than 2,000 mg. Reading food labels and cooking at home are the best ways to control your sodium intake.',
    },
  },
  {
    id: 'fluid_management',
    title: 'Fluid Management',
    tier: 'extended',
    icon: 'Droplets',
    content: {
      common: [
        'When your heart is not pumping well, too much fluid can build up in your body. Your doctor may ask you to limit how much you drink each day, typically 1.5 to 2 liters (about 6 to 8 cups).',
        'All liquids count toward your daily limit -- water, coffee, tea, juice, soup, and even ice. Popsicles and gelatin also count because they melt into liquid.',
        'Weighing yourself daily is the best way to track fluid retention. Sudden weight gain is often a sign of fluid buildup, even before you feel swollen.',
      ],
      track_a: [
        'The HEARTLAND app tracks your weight daily and alerts you to sudden changes that may indicate fluid retention. Use it alongside your fluid tracking to stay within your limit.',
      ],
      track_b: [
        'Keep a written log of your fluid intake in your paper diary. Use a measuring cup to know how much you are drinking. Call your clinic if you notice increased swelling or rapid weight gain.',
      ],
    },
    question: {
      text: 'Why is it important to limit fluids?',
      options: [
        'Drinking less helps you lose weight faster',
        'Too much fluid makes your heart work harder',
        'Fluids interfere with your medications',
        'You only need to limit fluids in summer',
      ],
      correctIndex: 1,
      explanation:
        'Too much fluid makes your heart work harder because it has to pump a larger volume of blood. Limiting fluids helps reduce the workload on your heart and prevents fluid buildup.',
    },
  },
  {
    id: 'when_to_call',
    title: 'When to Call for Help',
    tier: 'extended',
    icon: 'Phone',
    content: {
      common: [
        'Knowing when to call your clinic and when to call 911 can save your life. Not all symptoms need emergency care, but some do.',
        'Call your clinic the same day if you notice: weight gain of 3+ pounds in 2 days, increased swelling in your legs or belly, new or worsening shortness of breath with activity, needing more pillows to sleep, or side effects from your medications.',
        'Call 911 immediately if you have: chest pain or pressure, fainting or loss of consciousness, severe shortness of breath at rest that does not improve, or confusion and inability to think clearly.',
      ],
      track_a: [
        'The HEARTLAND app will alert you when your daily entries suggest you need to contact your clinic. For emergencies (chest pain, fainting, severe breathing trouble), always call 911 first -- do not wait for an app alert.',
      ],
      track_b: [
        'Keep your clinic phone number and 911 near your phone or on your paper diary. Review your daily entries for warning signs. If in doubt about whether to call, it is always safer to call.',
      ],
    },
    question: {
      text: 'When should you call 911?',
      options: [
        'When you gain 2 pounds in a week',
        'When you run out of medication',
        'When you have chest pain, fainting, or cannot breathe at rest',
        'When you feel a little tired',
      ],
      correctIndex: 2,
      explanation:
        'Call 911 immediately for chest pain, fainting, or severe shortness of breath at rest. These are emergencies that need immediate medical attention. For non-emergency concerns like weight gain or medication side effects, call your clinic.',
    },
  },
  {
    id: 'activity_guidance',
    title: 'Staying Active Safely',
    tier: 'extended',
    icon: 'Footprints',
    content: {
      common: [
        'Regular physical activity helps your heart get stronger over time. Start slowly with 5 to 10 minutes of walking per day, and gradually increase to 30 minutes on most days.',
        'If your doctor recommends cardiac rehabilitation, attend all sessions. Cardiac rehab provides supervised exercise and education specifically designed for people with heart conditions.',
        'Rest when you feel tired, and avoid heavy lifting or straining. It is normal to feel slightly short of breath during exercise, but stop and rest if you feel dizzy, have chest pain, or become very short of breath.',
      ],
      track_a: [
        'Use the HEARTLAND app to record your daily activity alongside your vitals. Tracking your exercise helps your doctor understand your overall progress and adjust your care plan.',
      ],
      track_b: [
        'Write down your daily activity in your paper diary -- how many minutes you walked and how you felt. Share this with your doctor at your next visit to help plan your exercise goals.',
      ],
    },
    question: {
      text: 'How much walking should you start with?',
      options: [
        '30 minutes right away',
        '5 to 10 minutes per day',
        '1 hour per day',
        'You should not exercise with heart failure',
      ],
      correctIndex: 1,
      explanation:
        'Start with 5 to 10 minutes of walking per day and gradually increase. Starting slowly helps your heart adapt safely. Most people with heart failure benefit from regular, gentle exercise.',
    },
  },
];
