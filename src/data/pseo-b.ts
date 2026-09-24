import type { PseoEntry } from "./pseo-a";

const TAB_PICK = "When the browser picker opens, choose the Chrome Tab tab, select the tab, and tick 'Share tab audio'. Without that checkbox no audio reaches the captioner.";

export const pseoB: PseoEntry[] = [
  {
    slug: "captions-for-hard-of-hearing",
    title: "Live captions for hard-of-hearing users, free and private",
    h1: "Live captions for people who are hard of hearing",
    metaDescription: "Free real-time captions for videos, calls and podcasts in your browser. Adjustable font size up to 200%, high-contrast theme, floating window, audio stays on your device.",
    intro: "If you're hard of hearing, you often need captions exactly where the platform doesn't provide them: a web call, a news clip, a podcast. This tool captions any audio playing in a browser tab (or your microphone) and shows it in a floating window you can size, move and style for comfortable reading. It runs on your own device, so private conversations aren't sent to a transcription server.",
    source: "tab",
    steps: [
      { name: "Adjust caption style first", text: "Open Caption style and raise Font size (80–200%), pick a heavier weight, and try the High contrast theme." },
      { name: "Choose the source", text: "Browser tab for videos and web calls, Microphone for someone speaking in the room." },
      { name: "Start captions", text: "Click Start captions. For tabs: " + TAB_PICK },
      { name: "Place the floating window", text: "Resize the Picture-in-Picture window and park it near the speaker's video so your eyes don't travel far." },
    ],
    tips: [
      "Words appear muted first and turn bold once confirmed. Read the bold text if you want stable wording; the muted tail may still change.",
      "Background music and overlapping speakers reduce accuracy. Captions are machine-generated, not a replacement for a human CART captioner in critical situations.",
      "Install it as an app (PWA) so captions open in their own window with one click.",
      "The first run downloads the speech model (about 75 MB for the default); after that it's cached and starts much faster.",
    ],
    faqs: [
      { q: "Is it really free?", a: "Yes. There's no account, trial or paid tier. Transcription runs on your computer, so there's no server cost to pass on." },
      { q: "Can it caption phone calls?", a: "Only if the call plays in a browser tab, such as Meet, Teams web or Zoom web. For a phone on speaker, use microphone mode." },
      { q: "Does it show who is speaking?", a: "No, speaker labels aren't supported. Captions appear as a continuous stream split into short paragraphs." },
    ],
    related: ["captions-for-deaf-users", "captions-for-discord-calls", "captions-for-microsoft-teams"],
  },
  {
    slug: "captions-for-deaf-users",
    title: "Real-time captions for Deaf users: any tab, on-device",
    h1: "Real-time captions for Deaf and deaf users, on your own device",
    metaDescription: "On-device live captions for Deaf users: caption web meetings, live streams and in-person speech via microphone. Floating window, exportable transcript, no uploads.",
    intro: "For Deaf users, a missing caption track means missing the content entirely. This tool gives you a fallback you control: it transcribes whatever your browser can hear, or a microphone for in-person conversation, and keeps a scrollable transcript you can reread if you missed something. It doesn't replace sign language interpretation or professional captioning, but it's there whenever those aren't.",
    source: "tab",
    steps: [
      { name: "Pick tab or microphone", text: "Use tab mode for online content and calls; use microphone mode to caption someone speaking near your laptop." },
      { name: "Set the language", text: "Pinning the spoken language improves stability compared with Auto-detect." },
      { name: "Start and confirm permissions", text: "Click Start captions and approve the tab picker (tick 'Share tab audio') or the microphone prompt." },
      { name: "Review or export", text: "Scroll back through the transcript at any time. After Stop, export TXT/SRT/VTT or share via a link that contains the text itself." },
    ],
    tips: [
      "For conversations, place the laptop between you and the speaker and ask them to face it. Distance and noise are the biggest accuracy killers.",
      "Use the High contrast caption theme and a large font for quick glances.",
      "Keep a custom vocabulary list of names you meet often (colleagues, places) so they're spelled right.",
    ],
    faqs: [
      { q: "Does it work without internet?", a: "Transcription itself runs locally once the model is cached, but the page and model need an internet connection to load the first time. Tab captioning also needs whatever the tab needs (for example a live stream)." },
      { q: "Is it accurate enough for work meetings?", a: "With clear audio, Whisper is usually quite readable, but it makes mistakes with names, accents and crosstalk. Treat it as assistive, not authoritative." },
      { q: "Can others read along with me?", a: "After Stop you can share a link that encodes the transcript in the URL (short sessions only), so nothing is uploaded." },
    ],
    related: ["captions-for-hard-of-hearing", "captions-for-job-interviews", "captions-for-online-classes"],
  },
  {
    slug: "captions-for-job-interviews",
    title: "Live captions for online job interviews",
    h1: "Captions for video job interviews you join in the browser",
    metaDescription: "Follow every question in an online interview with private, on-device captions in a floating window. Works with Meet, Zoom web, Teams web. No bot joins the call.",
    intro: "In an interview a misheard question costs more than in any other call. If you use captions as a hearing accommodation, or the interviewer has an accent you're still tuning into, this tool can caption the interview tab on your own device. No note-taking bot joins the meeting, and the audio never leaves your computer.",
    source: "tab",
    steps: [
      { name: "Test before the day", text: "Open a YouTube interview video, caption it once so the model is downloaded and cached. Interview day then starts instantly." },
      { name: "Join through the browser", text: "Use the web version of Meet, Zoom or Teams so the interview audio plays in a tab." },
      { name: "Start captions and share the tab", text: TAB_PICK },
      { name: "Place the window near the camera", text: "Drag the floating window close to your webcam so reading captions still looks like eye contact." },
    ],
    tips: [
      "If you need captions as an accommodation, it's fine to tell the interviewer. Many employers also offer built-in captions if asked.",
      "Close heavy tabs beforehand; transcription uses your GPU or CPU.",
      "Don't save or share the transcript without the interviewer's consent; local-only processing doesn't change consent rules.",
    ],
    faqs: [
      { q: "Can the interviewer see the captions?", a: "Only if you share your screen while the floating window is visible. Otherwise it's only on your display." },
      { q: "Will it detect my own voice?", a: "Tab capture hears the interviewer, not your microphone. That keeps the captions focused on their questions." },
      { q: "What if the interview is on a desktop app?", a: "Ask for a browser link, or use microphone mode with speakers (less accurate)." },
    ],
    related: ["captions-for-microsoft-teams", "captions-for-deaf-users", "captions-for-webex"],
  },
  {
    slug: "hindi-live-transcription-for-lectures",
    title: "Hindi live transcription for lectures (हिन्दी कैप्शन)",
    h1: "Live Hindi transcription for lectures and classes",
    metaDescription: "Live Hindi captions for online lectures, YouTube classes and in-person talks. Whisper runs in your browser, captions in Devanagari, no upload. Free.",
    intro: "Plenty of lectures in India are delivered in Hindi or in Hinglish, but most captioning tools either ignore Hindi or require an upload to a server. Whisper, the model this tool runs locally, is multilingual and supports Hindi. Pin Hindi in the language picker and captions appear in Devanagari for lectures in a browser tab or, with microphone mode, in a classroom.",
    source: "tab",
    lang: "hi",
    steps: [
      { name: "Pick Hindi", text: "Open Language and choose हिन्दी (Hindi). Pinning it is more reliable than Auto-detect for Hindi." },
      { name: "Use a multilingual model", text: "Keep a multilingual Whisper model selected. English-only models disable other languages." },
      { name: "Start and share the lecture tab", text: TAB_PICK },
      { name: "Save notes", text: "After the lecture, export the Hindi transcript as TXT, or SRT/VTT to pair with the recording." },
    ],
    tips: [
      "For Hinglish lectures, Whisper usually writes English words in Devanagari or switches script mid-sentence. If most content is English with Hindi phrases, try pinning English instead.",
      "Hindi accuracy on small models is lower than English. Clear audio and larger models help noticeably.",
      "Subject terms (like names of acts, formulas or authors) can go into custom vocabulary to reduce misspellings.",
      "Whisper can't translate to Hindi here; it transcribes what's spoken.",
    ],
    faqs: [
      { q: "Is Hindi output in Devanagari or Roman script?", a: "Whisper outputs Hindi in Devanagari. Romanised Hindi (Hinglish typed in English letters) isn't a separate option." },
      { q: "Can it caption a teacher in the classroom?", a: "Yes, with microphone mode. Sit close to the teacher; far-field audio in a large hall is much less accurate." },
      { q: "Which other Indian languages work?", a: "The picker currently lists Hindi among 16 languages. Other Indian languages aren't in the picker yet." },
    ],
    related: ["captions-for-online-classes", "captions-for-hard-of-hearing", "captions-for-webex"],
  },
  {
    slug: "microphone-live-captions",
    title: "Live captions from your microphone for in-person talks",
    h1: "Caption in-person speech with your microphone",
    metaDescription: "Turn your laptop into a live captioner for in-room conversations, talks and meetings. Microphone speech-to-text runs locally in your browser. Free, private.",
    intro: "Not everything worth captioning is on a screen. Microphone mode listens through your laptop or headset mic and captions what's said in the room: a colleague at your desk, a talk you're attending, a family conversation. The model runs locally, so audio is never sent anywhere.",
    source: "mic",
    steps: [
      { name: "Select Microphone", text: "Switch the source toggle from Browser tab to Microphone." },
      { name: "Click Start captions", text: "Allow microphone access when the browser asks. That prompt needs a real click, so start it yourself." },
      { name: "Position the mic", text: "Point the laptop toward the speaker. An external USB or lapel mic near them is much better than a laptop mic across the room." },
      { name: "Read, then export", text: "Captions float in a PiP window. Stop when done and export the transcript if you need it." },
    ],
    tips: [
      "Microphone mode captures your own voice too, so use it for listening rather than for a call where you also talk.",
      "Echoey rooms and background chatter cause misheard words; move closer rather than turning volume up.",
      "Bluetooth headsets often switch to a low-quality mic profile; a wired or built-in mic is usually cleaner.",
    ],
    faqs: [
      { q: "Can it caption a phone call on speaker?", a: "Yes, put the phone near the laptop mic. Quality depends on the call's audio." },
      { q: "Does it work on mobile?", a: "Mobile browsers vary. Microphone mode is more likely to work than tab capture, but desktop Chrome/Edge is the tested setup." },
      { q: "Is anything recorded?", a: "Audio isn't saved or uploaded. Only the text transcript is kept locally in your browser unless you clear it." },
    ],
    related: ["captions-for-deaf-users", "hindi-live-transcription-for-lectures", "captions-for-hard-of-hearing"],
  },
];
