export interface PseoEntry {
  slug: string;
  title: string;
  h1: string;
  metaDescription: string;
  intro: string;
  source: "tab" | "mic";
  lang?: string;
  steps: { name: string; text: string }[];
  tips: string[];
  faqs: { q: string; a: string }[];
  related: string[];
}

const TAB_PICK = "When the browser picker opens, choose the Chrome Tab tab, select the tab, and tick 'Share tab audio'. Without that checkbox no audio reaches the captioner.";

export const pseoA: PseoEntry[] = [
  {
    slug: "captions-for-microsoft-teams",
    title: "Free live captions for Microsoft Teams (web)",
    h1: "Live captions for Microsoft Teams calls, in a floating window",
    metaDescription: "Caption Microsoft Teams meetings joined in the browser. Whisper runs on your device, captions float over any app, nothing is uploaded. Free, no sign-up.",
    intro: "Teams has its own live captions, but they live inside the meeting window and your organisation's admin decides whether they're on. If you join Teams in Chrome or Edge at teams.microsoft.com, this tool can caption the tab's audio locally and float the text in a Picture-in-Picture window, so you can keep reading while you share your screen or take notes in another app.",
    source: "tab",
    steps: [
      { name: "Join Teams in the browser", text: "Open the meeting link and choose 'Continue on this browser' (or use teams.microsoft.com). The desktop Teams app plays audio outside the browser, so it can't be captured as a tab." },
      { name: "Open the captioner in a second tab", text: "Pick your language under Language if you know it, then click Start captions." },
      { name: "Share the Teams tab with audio", text: TAB_PICK },
      { name: "Go back to the meeting", text: "The floating caption window stays on top while you work in Teams, Outlook or any other app." },
    ],
    tips: [
      "If you must use the desktop Teams app, switch the source to Microphone and place your laptop near the speakers. Accuracy drops, but it works for in-room audio.",
      "Headphones don't matter for tab capture: the browser reads the audio before it reaches your output device.",
      "Pin the meeting language instead of Auto-detect if speakers switch between languages, it reduces flicker.",
      "Export the transcript as TXT, SRT or VTT after Stop for your own notes. Check your organisation's recording policy first.",
    ],
    faqs: [
      { q: "Do other participants see that I'm captioning?", a: "No. Tab capture is a browser feature on your computer. Nothing joins the meeting and no bot is added. You are still responsible for following your company's policy on transcripts." },
      { q: "Why is there no audio option in the picker?", a: "Tab audio sharing is supported in Chromium browsers (Chrome, Edge, Brave). In Firefox and Safari the option is missing or limited; use microphone mode instead." },
      { q: "Is this better than Teams' built-in captions?", a: "Not always. Teams captions know who is speaking. This tool's advantages are that it works without admin settings, floats over other apps, and keeps audio on your device." },
    ],
    related: ["captions-for-webex", "captions-for-job-interviews", "captions-for-hard-of-hearing"],
  },
  {
    slug: "captions-for-webex",
    title: "Free live captions for Webex meetings (web app)",
    h1: "Captions for Webex meetings joined in your browser",
    metaDescription: "Get live captions for Cisco Webex meetings in the web app. Local Whisper transcription, floating picture-in-picture captions, no upload, no account.",
    intro: "Webex's own closed captions depend on your plan and the host's settings. When you join a Webex meeting through the web app in Chrome or Edge, the meeting audio plays inside a browser tab, which means you can caption it yourself with Whisper running on your machine, independent of what the host has enabled.",
    source: "tab",
    steps: [
      { name: "Join from your browser", text: "On the Webex join page, choose to join from your browser instead of downloading the app." },
      { name: "Start the captioner", text: "In another tab, set the language and click Start captions. A floating window opens first." },
      { name: "Pick the Webex tab", text: TAB_PICK },
      { name: "Return to Webex", text: "Captions update roughly every second in the floating window, above the meeting and your other apps." },
    ],
    tips: [
      "Webex's web app may ask you to allow your microphone; that's separate from caption capture and both can be active at once.",
      "If captions lag on an older laptop, pick the smaller model in settings or close other heavy tabs; transcription runs on your GPU/CPU.",
      "For webinars where you only listen, mute your mic in Webex; the captioner only hears the tab, not your room.",
    ],
    faqs: [
      { q: "Does the host need to enable anything?", a: "No. Capture happens in your browser from the audio you already receive. The host's caption setting doesn't affect it." },
      { q: "Can it caption the Webex desktop app?", a: "Not as a tab. Use microphone mode near your speakers, or join the same meeting in the browser." },
      { q: "Is my meeting audio sent anywhere?", a: "No. The audio is processed by the Whisper model inside your browser; only the model files are downloaded once and cached." },
    ],
    related: ["captions-for-microsoft-teams", "captions-for-online-classes", "captions-for-deaf-users"],
  },
  {
    slug: "captions-for-twitch-streams",
    title: "Live captions for Twitch streams (any channel)",
    h1: "Add live captions to any Twitch stream you watch",
    metaDescription: "Watch Twitch with live captions even when the streamer doesn't provide them. Runs locally in your browser, floats over games and other apps. Free.",
    intro: "Most Twitch streamers don't run a caption extension, and many that do only support English. As a viewer, you can caption any stream playing in a browser tab yourself. The captions float in their own window, so you can watch the stream in theatre mode or keep reading while you play a game in another window.",
    source: "tab",
    steps: [
      { name: "Open the stream in a tab", text: "Go to twitch.tv/<channel> in Chrome, Edge or Brave and start playback." },
      { name: "Start captions", text: "In another tab, choose the streamer's language (or Auto-detect) and click Start captions." },
      { name: "Share the Twitch tab", text: TAB_PICK },
      { name: "Arrange your windows", text: "Resize the floating caption window and set its opacity in PiP window settings so it doesn't cover the game HUD." },
    ],
    tips: [
      "Game audio and music compete with the voice. Lower the in-stream music if the streamer offers separate volume, or expect some missed words during loud moments.",
      "Twitch adds a few seconds of stream delay; captions follow the audio you hear, not the live chat.",
      "Keep the Twitch tab unmuted in the browser. Muting the tab silences the captured audio too, but lowering your system volume is fine.",
      "Pin the language for bilingual streamers to avoid Whisper switching languages mid-sentence.",
    ],
    faqs: [
      { q: "Does the streamer need to install anything?", a: "No. This is purely viewer-side and works on any channel you can watch in the browser." },
      { q: "Can I use it while streaming myself?", a: "It captions what you hear, not what you broadcast. It isn't a caption overlay for OBS." },
      { q: "Will it slow down my game?", a: "Whisper uses your GPU via WebGPU when available. On a gaming PC the impact is usually small; on laptops choose the smaller model." },
    ],
    related: ["captions-for-discord-calls", "captions-for-deaf-users", "captions-for-online-classes"],
  },
  {
    slug: "captions-for-discord-calls",
    title: "Live captions for Discord voice channels and calls",
    h1: "Captions for Discord voice chats, stages and calls",
    metaDescription: "Caption Discord voice channels in the Discord web app. Local speech-to-text with Whisper, floating captions, no bot added to the server, nothing uploaded.",
    intro: "Discord has no built-in live captions for voice channels, and caption bots have to join the channel and send audio to a server. If you open Discord in the browser at discord.com/app, the voice audio plays in that tab, so you can caption it on your own device without adding any bot and without anyone's voice leaving your computer.",
    source: "tab",
    steps: [
      { name: "Use Discord in the browser", text: "Log in at discord.com/app in Chrome or Edge and join the voice channel, stage or DM call. The desktop Discord app can't be captured as a tab." },
      { name: "Start captions", text: "Open this tool in a new tab and click Start captions." },
      { name: "Share the Discord tab", text: TAB_PICK },
      { name: "Keep chatting", text: "Captions float above Discord, your game or anything else." },
    ],
    tips: [
      "Captions don't label speakers. In busy channels with overlapping voices, expect merged sentences.",
      "Discord's noise suppression on other people's mics tends to help accuracy.",
      "Ask your friends before saving transcripts of voice chats; captions themselves stay in your browser.",
    ],
    faqs: [
      { q: "Does this add a bot to my server?", a: "No. There is no bot and nothing joins the channel. It only listens to the Discord tab on your machine." },
      { q: "Can it caption the Discord desktop app?", a: "Not directly. Use the browser version, or switch the source to microphone mode near your speakers." },
      { q: "What languages work?", a: "The language picker includes English, Hindi, Spanish, French, German, Portuguese, Japanese, Korean, Chinese, Arabic and more, plus Auto-detect." },
    ],
    related: ["captions-for-twitch-streams", "captions-for-hard-of-hearing", "captions-for-microsoft-teams"],
  },
  {
    slug: "captions-for-online-classes",
    title: "Live captions for online classes and webinars",
    h1: "Live captions for online classes, in any browser-based classroom",
    metaDescription: "Caption live online classes on Zoom web, Google Meet, Teams, Moodle or YouTube Live. Private, on-device transcription; export notes as TXT/SRT/VTT.",
    intro: "Online classes run on many platforms: a Meet link one day, a Teams web meeting the next, a YouTube Live session for a big lecture. Because this tool captions a browser tab rather than a specific app, one workflow covers all of them, and the transcript you keep afterwards is a handy starting point for revision notes.",
    source: "tab",
    steps: [
      { name: "Open the class in a browser tab", text: "Join the class through the platform's web version (Meet, Zoom web client, Teams web, a Moodle/Canvas embedded video or YouTube Live)." },
      { name: "Set the class language", text: "Choose the language the teacher speaks. Pinning it helps with technical vocabulary." },
      { name: "Start and share the tab", text: TAB_PICK },
      { name: "Save the transcript", text: "After class, click Stop and export TXT for notes or SRT/VTT if you're pairing it with a recording." },
    ],
    tips: [
      "Add course-specific terms (names, formulas, jargon) to the custom vocabulary so Whisper spells them correctly.",
      "Captions are machine-generated. For graded or official accommodations, ask your institution about certified captioning (CART).",
      "If the class is in-person, switch the source to Microphone and sit near the speaker.",
    ],
    faqs: [
      { q: "Will my teacher know?", a: "The tool doesn't join the class or notify anyone. Follow your institution's rules on recording and transcripts." },
      { q: "Does it work on a Chromebook?", a: "Chromebooks run Chrome, so tab capture and PiP generally work; speed depends on the device's hardware." },
      { q: "Can it transcribe a recorded lecture instead?", a: "Yes. Play the recording in a browser tab and caption it the same way." },
    ],
    related: ["hindi-live-transcription-for-lectures", "captions-for-webex", "captions-for-hard-of-hearing"],
  },
];
