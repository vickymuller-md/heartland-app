/**
 * HEARTLAND Patient Education -- All 8 Domain Constants
 *
 * Source: HEARTLAND Protocol v3.3, Module 4 (Teach-Back Domains)
 * Clinical content sourced from protocol Sections 4.3, 5.1, and 5.2.
 *
 * All 8 domains are available to every patient, whatever the facility tier
 * (including an unknown tier). The facility tier governs delivery format,
 * sequence and support -- never whether a domain exists.
 */

import type { EducationDomain } from './types';

export const EDUCATION_DOMAINS: EducationDomain[] = [
  {
    id: 'daily_weight',
    title: 'Daily Weight Monitoring',
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

  // Source: Protocol v3.3 Module 4 Section 4.3
  {
    id: 'what_is_hf',
    title: 'Understanding Heart Failure',
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
        'Your heart does not move blood as well as it should -- either because it is weak or because it is stiff',
        'You need a heart transplant right away',
        'Your heart beats too fast',
      ],
      correctIndex: 1,
      explanation:
        'Heart failure means your heart does not move blood as well as it should. For some people the heart muscle is too weak to pump well (HFrEF); for others it is stiff and cannot fill properly (HFpEF). It does not mean your heart has stopped. With proper treatment and monitoring, you can manage this condition effectively.',
    },
  },
  {
    id: 'sodium_restriction',
    title: 'Sodium (Salt) Restriction',
    icon: 'UtensilsCrossed',
    content: {
      common: [
        'Eating too much sodium (salt) causes your body to hold extra fluid, which makes your heart work harder. Most people with heart failure are advised to limit sodium. Your own target is set by your care team and written in your care plan -- a commonly used target is less than 2,000 milligrams (mg) per day.',
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
      text: 'Where do you find your own daily sodium target?',
      options: [
        'In my care plan, set by my care team',
        'It is the same number for everyone with heart failure',
        'On the front of any food package',
        'Sodium does not need a target',
      ],
      correctIndex: 0,
      explanation:
        'Your sodium target is individual and is written in your care plan by your care team. A target of less than 2,000 mg per day is commonly used, but ask your care team what applies to you. Reading food labels and cooking at home are the best ways to control your sodium intake.',
    },
  },
  {
    id: 'fluid_management',
    title: 'Recognizing Fluid Retention',
    icon: 'Droplets',
    content: {
      common: [
        'When your heart is not pumping well, extra fluid can build up in your body. The signs to watch for are a sudden gain in weight, swelling in your ankles, feet or belly, and needing more pillows or waking up short of breath at night.',
        'Weighing yourself daily is the best way to catch fluid retention early. Sudden weight gain is often the first sign, before you feel swollen.',
        'Some people are asked to limit how much they drink. This is not advice for everyone. Follow the limit written in your care plan, if you have one, and ask your care team whether a limit applies to you.',
      ],
      track_a: [
        'The HEARTLAND app tracks your weight daily and alerts you to sudden changes that may indicate fluid retention.',
      ],
      track_b: [
        'Write your weight and any swelling in your paper diary each day. Call your clinic if you notice increased swelling or rapid weight gain.',
      ],
    },
    question: {
      text: 'How do you know if you should limit fluids?',
      options: [
        'Everyone with heart failure has to limit fluids',
        'Only if my care team wrote a limit in my care plan',
        'Only when the weather is hot',
        'Only if I already have swelling',
      ],
      correctIndex: 1,
      explanation:
        'A fluid limit is not advice for everyone with heart failure. Follow the limit your care team wrote in your care plan, and ask them if you are not sure whether one applies to you. Whether or not you have a limit, daily weights and watching for swelling tell you when fluid is building up.',
    },
  },
  {
    id: 'when_to_call',
    title: 'When to Call for Help',
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
    icon: 'Footprints',
    content: {
      common: [
        'Regular physical activity is recommended for people whose heart failure is stable. Ask your care team whether you are stable enough to start, and follow the plan they write for you.',
        'Once your care team agrees, start slowly with 5 to 10 minutes of walking per day, and gradually increase to 30 minutes on most days.',
        'If your doctor recommends cardiac rehabilitation, attend all sessions. Cardiac rehab provides supervised exercise and education specifically designed for people with heart conditions.',
        'Precautions: rest when you feel tired, and avoid heavy lifting or straining. It is normal to feel slightly short of breath during exercise, but stop and rest if you feel dizzy, have chest pain, or become very short of breath. Do not start or increase activity while your symptoms are getting worse.',
      ],
      track_a: [
        'Use the HEARTLAND app to record your daily activity alongside your vitals. Tracking your exercise helps your doctor understand your overall progress and adjust your care plan.',
      ],
      track_b: [
        'Write down your daily activity in your paper diary -- how many minutes you walked and how you felt. Share this with your doctor at your next visit to help plan your exercise goals.',
      ],
    },
    question: {
      text: 'Before you start or increase walking, what should you do?',
      options: [
        'Start at 30 minutes right away',
        'Check with my care team that my heart failure is stable, then build up from the 5 to 10 minutes they plan with me',
        'Wait until I have no symptoms at all',
        'Nothing -- exercise is unsafe with heart failure',
      ],
      correctIndex: 1,
      explanation:
        'Regular activity is recommended once your heart failure is stable, so check with your care team first. From there, start with the 5 to 10 minutes a day they plan with you and build up gradually. Stop and rest if you feel dizzy, have chest pain, or become very short of breath.',
    },
  },
];
