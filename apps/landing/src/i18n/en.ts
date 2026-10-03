/**
 * English strings for the landing.
 *
 * Mirrors `de.ts` 1:1 - TypeScript enforces full coverage via the
 * `Record<keyof typeof de, string>` type below. Add keys in `de.ts`
 * first, then add the matching English translation here.
 */
import type { de } from "./de";

export const en: Record<keyof typeof de, string> = {
  // ===================== Hero =====================
  "hero.eyebrow": "SCRIPTZ // FOR CONTENT CREATORS",
  "hero.h1.keyword": "Script editor for content creators.",
  "hero.h1.line1": "Write,",
  "hero.h1.line2": "don't format.",
  "hero.lead":
    "The script editor for content creators. From idea to finished script in minutes. No screenplay corset, no AI, no subscription. Just you, your idea and a cursor that gets out of the way.",
  "hero.cta.download.mac": "Free for macOS",
  "hero.cta.download.win": "Free for Windows",
  "hero.cta.github": "On GitHub",
  "hero.cta.allplatforms": "Other platform? All downloads on GitHub →",
  "hero.meta.os.mac": "macOS 13+",
  "hero.meta.os.win": "Windows 10+",
  "hero.meta.zero": "0 trackers · 0 accounts · 0 AI",
  "hero.web.intro": "Want to try it first?",
  "hero.web.link": "Test it right in your browser →",
  "hero.web.hint": "Test editor, local in your browser. Data stays there.",

  // ===================== Page hero per route =====================
  // Each route has a unified page-hero on top (keyword eyebrow, H1,
  // subline, download CTA). Only the home variant (`/en`) uses the
  // historical `hero.h1.*` / `hero.lead` keys so the brand statement
  // stays bigger. Sub-routes pull from the `hero.{route}.*` keys here.
  "hero.warum.keyword": "WHY SCRIPTZ",
  "hero.warum.title": "Write scripts without the app getting in the way.",
  "hero.warum.subline":
    "Built for content creators who want their TikTok, Reels and YouTube Shorts scripts done faster - no screenplay corset, no AI, no subscription.",

  "hero.quickmodus.keyword": "THE DETAIL NOBODY ELSE HAS",
  "hero.quickmodus.title": "Quick mode: the two-hander workflow for Reels and Shorts.",
  "hero.quickmodus.subline":
    "Two speakers, one Enter. The cursor jumps to the next character automatically - no Tab, no typing names. Saves a minute per script.",

  "hero.noai.keyword": "THE NO-AI MANIFESTO",
  "hero.noai.title": "Script editor without AI. Your voice stays yours.",
  "hero.noai.subline":
    "No chat window, no suggestions, no „improve\" button. Your scripts live locally in a SQLite file, not in the cloud.",

  "hero.vergleich.keyword": "THE HONEST COMPARISON",
  "hero.vergleich.title": "ScriptZ vs. Final Draft, Notion, ChatGPT, Word.",
  "hero.vergleich.subline":
    "What ScriptZ does that the others don't - and where we deliberately stay small. Built as a free Final Draft alternative for short-form.",

  "hero.download.keyword": "FREE, LOCAL, OPEN SOURCE",
  "hero.download.title": "Download ScriptZ free - macOS and Windows.",
  "hero.download.subline":
    "One .dmg or .exe. No account, no trackers, no AI. Updates come automatically via the built-in updater.",

  "hero.ideen.keyword": "THE IDEAS PAGE",
  "hero.ideen.title": "Collect what you'll write next.",
  "hero.ideen.subline":
    "Script ideas for TikTok, Reels and Shorts in one place, sorted by folder. ⌘I captures them from anywhere, one shortcut turns them into a script - offline, no account.",

  // ===================== Home section (`/en`) =====================
  // Dedicated home content below the page hero: screenshot gallery,
  // three feature teasers, comparison hint, closing download block.
  "home.gallery.h2": "Three views, one app.",
  "home.gallery.sub":
    "Overview, ideas, editor. The sidebar with the pipeline on the left, the sheet in the middle, the inspector on the right. That's all a script tool needs.",

  "home.features.h2": "Four things ScriptZ is built for.",
  "home.feature.quick.title": "Quick mode for two speakers",
  "home.feature.quick.body":
    "Two-hander dialog as if by itself: Enter jumps to the next character, no Tab, no typing names. Saves a minute per 60-second reel.",
  "home.feature.quick.link": "Quick mode explained →",
  "home.feature.length.title": "Target range and timeline",
  "home.feature.length.body":
    "Give a folder a target length like 0:45-1:05. Below it you get a quiet hint, only past the upper bound does the runtime turn red. ⌘J shows who speaks when, right under the sheet.",
  "home.feature.length.link": "See how it looks →",
  "home.feature.pipeline.title": "A pipeline from idea to online",
  "home.feature.pipeline.body":
    "Ideas, Writing, Ready to shoot, Shot, Online: every script has a stage, and the sidebar shows what sits where. Folders stay for topics, clients and series.",
  "home.feature.pipeline.link": "To the ideas page →",
  "home.feature.noai.title": "No AI, on purpose",
  "home.feature.noai.body":
    "No suggestions, no „improve\" button, no cloud upload. Your voice stays yours, your script stays local in a SQLite file.",
  "home.feature.noai.link": "The no-AI manifesto →",

  "home.compare.h2": "Compared.",
  "home.compare.body":
    "Final Draft can handle feature screenplays. Notion can run wikis. ChatGPT can brainstorm. ScriptZ can: scripts for reels, fast. That's all - and that was worth it to us.",
  "home.compare.cta": "See the full comparison →",

  "home.closing.eyebrow": "READY?",
  "home.closing.h2": "Free. Local. No account.",
  "home.closing.body":
    "macOS 13+ or Windows 10+. One click, one installer, done. No sign-in, no mailing list, no subscription.",

  // macOS install hint
  "install.mac.summary": "macOS blocks the app the first time you open it?",
  "install.mac.body":
    "That's normal - ScriptZ is open source and not registered with Apple. Run this command in Terminal once, then everything works as expected:",
  "install.mac.why":
    "Apple charges for a signature that would skip this step. Until that pays off, the short command is the price for ScriptZ staying free and account-less.",
  "install.mac.whyShort.label": "Why?",
  "install.mac.whyShort.body":
    "Apple charges for a signature that would skip this step. Until that pays off, the short command is the price for ScriptZ staying free and account-less.",

  // Windows install hint
  "install.win.summary": "Windows SmartScreen kicks in on first launch?",
  "install.win.body":
    "That's normal - ScriptZ is open source and doesn't (yet) have an EV code-signing certificate. Two clicks and you're through:",
  "install.win.step1": "1. In the SmartScreen dialog, click „More info\".",
  "install.win.step2": "2. Then click the button that appears: „Run anyway\".",
  "install.win.why":
    "Microsoft requires a paid EV code-signing certificate for instant acceptance. Until that pays off, the two extra clicks are the price for ScriptZ staying free and account-less.",
  "install.win.whyShort.label": "Why?",
  "install.win.whyShort.body":
    "Microsoft requires an EV code-signing certificate. Until that pays off, two clicks are the price for ScriptZ staying free and account-less.",

  // Copy button (macOS only, but strings are shared)
  "install.copy": "Copy",
  "install.copied": "Copied ✓",
  "install.copyManual": "Please copy manually",

  // ===================== App chrome: sidebar + header bar =====================
  "tab.home.title": "Overview",
  "tab.home.long": "Script editor for TikTok, Reels and YouTube Shorts",
  "tab.home.aria": "Overview (back to top)",
  "tab.ideas.title": "Ideas",
  "tab.warum.short": "Why?",
  "tab.warum.long": "Write scripts without the app getting in the way",
  "tab.quickmodus.short": "Quick mode",
  "tab.quickmodus.long": "Quick mode - the trick nobody else can do",
  "tab.noai.short": "No AI",
  "tab.noai.long": "The no-AI manifesto",
  "tab.compare.short": "Compare",
  "tab.compare.long": "Compared to everything else",
  "tab.download.short": "Download",
  "tab.download.long.mac": "Download - macOS, free",
  "tab.download.long.win": "Download - Windows, free",

  "status.opensource": "Open Source",
  "status.saved": "Saved",

  "toolbar.back.aria": "Back to overview",
  "toolbar.stage": "Online",
  "toolbar.stage.title": "This page's stage. In the app, every script moves from idea to online.",
  "toolbar.download": "Download",
  "side.aria": "Sidebar",
  "side.section.scripts": "Scripts",
  "side.counter.unit": "words",
  "side.counter.sub": "on this page",
  "side.counter.title":
    "In the app, this spot holds a calm writing counter, e.g. „1,240 words this week\". No goal, no streak.",

  // ===================== Tab: WARUM =====================
  "warum.caption": "INT. SCRIPTZ - SCRIPT EDITOR FOR TIKTOK, REELS AND YOUTUBE SHORTS",
  "warum.action1":
    "An empty page. Cursor blinks. You type and the formatting just happens. Four block types, nothing more: Action, Character, Dialog, Parenthetical. A parenthesis in a dialog line? Becomes a delivery cue. Character name? Auto-centered, all caps. Tab? Block picker. Enter? Next line - usually already in the right block.",
  "warum.action2":
    "ScriptZ is built for content creators, not for screenwriters. You don't want a 90-minute feature-film layout. You want a TikTok script done by half past two, before the good light is gone.",
  "warum.timo1.paren": "(direct)",
  "warum.timo1.dialog":
    "You type, the editor formats. Characters are auto-detected, get a color and their share of the speaking time. You don't have to set anything up. You don't have to click anything. You just have to write.",
  "warum.axel1.dialog": "Sounds like every tool since 2015.",
  "warum.timo2.dialog":
    "Try it. Make a script, write two speakers. Then hit Enter. You'll see the cursor land in the right block, with the right speaker in front. That's quick mode. It saves two keystrokes per switch - and on a 60-second reel with 12 switches, that's a minute.",
  "warum.axel2.paren": "(curious)",
  "warum.axel2.dialog": "And AI? Does it suggest what to say?",
  "warum.timo3.dialog":
    "No. Deliberately not. Creativity is your job. If you wanted a model to write for you, you'd have ChatGPT open.",
  "warum.axel3.dialog": "And how do I know if my reel is getting too long?",
  "warum.timo4.dialog":
    "You give the folder a target range, say 0:45 to 1:05. Below it, you only get a quiet hint. The runtime only turns red past the upper bound. And ⌘J opens the timeline under the sheet: who speaks when, where the hook sits, where you can cut.",
  "warum.axel4.dialog": "And once it's done?",
  "warum.timo5.dialog":
    "Then it moves on: Idea, Writing, Ready to shoot, Shot, Online. The sidebar shows what sits where. Folders stay for topics, clients and series.",
  "warum.action3": "Three views of the app: overview, ideas, editor. Click through.",

  "shot.tab.overview": "Overview",
  "shot.tab.ideas": "Ideas",
  "shot.tab.editor": "Editor",
  "shot.alt.overview": "ScriptZ overview: sidebar with pipeline, scripts grouped by stage",
  "shot.alt.ideas": "ScriptZ ideas page with folder chips and an expanded idea",
  "shot.alt.editor": "ScriptZ editor with character colors, inspector and timeline",

  "jump.label.long": "Up next:",
  "jump.label.short": "Next:",
  "jump.btn.quickmodus": "→ Quick mode explained",
  "jump.btn.noai": "→ Why no AI",
  "jump.btn.noaiAlt": "→ Why no AI",
  "jump.btn.compare": "→ Compared to others",
  "jump.btn.compareShort": "→ Compare",
  "jump.btn.download": "→ Download",
  "jump.btn.backToStart": "→ Back to start",

  // ===================== Tab: QUICKMODUS =====================
  "quick.caption": "INT. QUICK MODE - THE TWO-HANDER WORKFLOW FOR REELS AND SHORTS",
  "quick.action1":
    "Quick mode is what makes ScriptZ irreplaceable. Once your script has exactly two speakers, it kicks in. After each dialog, one Enter and the cursor jumps automatically to the other character and right into the next dialog. No Tab, no typing the speaker name, no second Enter.",
  "quick.beat": "Tack, tack, tack. Enter.",
  "quick.action2":
    "In practice: two keystrokes saved per speaker switch. On a typical 60-second reel with ten to twelve switches, that's almost a minute. Three scripts a day? Three minutes. Per week? A quarter hour you spent writing instead of formatting.",
  "quick.timo1.dialog": "Here's what it looks like for real. I type something.",
  "quick.axel1.dialog": "I reply. Enter.",
  "quick.timo2.dialog": "Cursor is already here. Nobody typed „TIMO\".",
  "quick.axel2.dialog": "Nobody typed „AXEL\". Nobody hit Tab.",
  "quick.timo3.dialog": "We just write. The editor knows what we want.",
  "quick.action3":
    "Three characters in the script? Quick mode pauses automatically - then the editor doesn't know who's next. Drop back to two and it's back. It switches itself on. The toggle in the header bar is only there in case you ever don't want it.",
  "quick.callout.eyebrow": "THE DETAIL THAT MATTERS",
  "quick.callout.body":
    "Neither Word, nor Notion, nor Final Draft, nor ChatGPT, nor Apple Notes does this. For us it's a core feature, from day one. Anyone who's ever typed two speakers at once knows what that saves per day.",

  // ===================== Tab: NO-AI =====================
  "noai.caption": "INT. NO-AI MANIFESTO - SCRIPT EDITOR WITHOUT AI",
  "noai.action1":
    "ScriptZ has no AI built in. No chat window, no „write me a script\", no auto-rephrasing, no suggestions, no autocomplete beyond character names from your own script. Deliberately not.",
  "noai.axel1.paren": "(skeptical)",
  "noai.axel1.dialog":
    "Every other tool has AI. You're selling „no AI\" as a feature?",
  "noai.timo1.dialog":
    "Yes. Because your voice is your product. If a model writes half the script, half the voice is the model.",
  "noai.axel2.dialog": "Sometimes you just get stuck.",
  "noai.timo2.dialog":
    "Then the answer isn't „let the model take over\", it's „take a three-minute break\". That's what ⌘I is for, for the quick thought, and focus mode, which hides everything but the sheet. Both offline, both without a foreign voice.",
  "noai.beat": "Axel nods. Long pause.",
  "noai.card1.title": "No API key",
  "noai.card1.body": "No cloud keys, no tokens, no per-word billing.",
  "noai.card2.title": "No training-data contribution",
  "noai.card2.body": "Your script doesn't get uploaded. It lives locally in a SQLite file.",
  "noai.card3.title": "No „improve\" button",
  "noai.card3.body": "Your script isn't broken. It doesn't need outside improvement.",
  "noai.card4.title": "Instead: a fast editor",
  "noai.card4.body":
    "Quick mode, character auto-detection, four block hotkeys, a timeline. Tools that carry your idea from your head to the page - without rewriting it.",

  // ===================== Tab: VERGLEICH =====================
  "cmp.caption": "EXT. COMPARE - SCRIPTZ VS. FINAL DRAFT, NOTION, CHATGPT",
  "cmp.action1":
    "ScriptZ as a Final Draft alternative for short-form: other tools can do plenty we can't. Here's the list of what we can do that they can't:",
  "cmp.head.crit": "What you need",
  "cmp.row.format": "Format happens without you",
  "cmp.row.quick": "Quick mode for 2 speakers",
  "cmp.row.chars": "Characters auto-detected",
  "cmp.row.short": "Built for short-form",
  "cmp.row.length": "Target range + speaker timeline",
  "cmp.row.pipeline": "Pipeline from idea to online",
  "cmp.row.noai": "Deliberately no AI",
  "cmp.row.local": "Free & local",
  "cmp.row.fast": "Open in < 1s",
  "cmp.mark.yes": "YES",
  "cmp.mark.no": "NO",
  "cmp.mark.feature": "Feature film",
  "cmp.mark.featureNo": "NO, feature film",
  "cmp.mark.copilot": "Copilot",
  "cmp.mark.notionai": "Notion AI",
  "cmp.mark.isai": "It is AI",
  "cmp.mark.beatai": "Beat AI",
  "cmp.mark.appleint": "Apple Int.",
  "cmp.mark.cloud": "Cloud",
  "cmp.mark.paid": "Paid",
  "cmp.mark.appleonly": "Apple-only",
  "cmp.mark.meh": "Meh",
  "cmp.mark.pages": "Pages",
  "cmp.mark.diy": "DIY",
  "cmp.action2":
    "We can replace none of that. Final Draft can submit a feature screenplay to the WGA. Notion can run a wiki. ChatGPT can brainstorm with you. We can: scripts for reels, fast. That's all - and it was worth it to us.",

  // ===================== Tab: DOWNLOAD =====================
  "dl.caption": "INT. DOWNLOAD - SCRIPTZ FREE FOR MACOS AND WINDOWS",
  "dl.action1.mac":
    "macOS 13 or newer. Free. Open source. First launch: right-click the app icon → „Open\". Apple requires that for unsigned apps. Updates come automatically after that.",
  "dl.action1.win":
    "Windows 10 or newer. Free. Open source. On first launch, SmartScreen will pop up - click „More info\" → „Run anyway\" once, then everything works automatically. Updates come without any extra hurdle.",
  "dl.eyebrow.os.mac": "macOS 13+",
  "dl.eyebrow.os.win": "Windows 10+",
  "dl.h": "Free. Local. No account.",
  "dl.sub.mac":
    "One .dmg, no trackers, no sign-in, no „updates by email\". You download the app, drag it to your Applications folder, and that's it.",
  "dl.sub.win":
    "An .exe installer, no trackers, no sign-in, no „updates by email\". Double-click, done.",
  "dl.cta.dmg": "Download .dmg",
  "dl.cta.exe": "Download .exe",
  "dl.cta.code": "Source on GitHub",
  "dl.fallback.label": "Other platform? All downloads on GitHub →",
  "dl.stat.version": "current version",
  "dl.stat.tracker": "trackers",
  "dl.stat.accounts": "accounts",
  "dl.stat.ai": "AI",
  "dl.stat.dmg": ".dmg",
  "dl.stat.exe": ".exe",
  "dl.web.intro": "Want to try it first?",
  "dl.web.link": "Test it right in your browser →",
  "dl.web.sub": "Test editor, no account, all local in your browser.",
  "dl.firstRun": "FIRST LAUNCH",
  "dl.action2.mac":
    "On first launch, macOS reports the app cannot be verified. That's normal - ScriptZ is open source and not registered with Apple. Run the command below in Terminal once, then everything works as expected.",
  "dl.action2.win":
    "On first launch, Windows SmartScreen reports the app cannot be verified. That's normal - ScriptZ is open source and doesn't (yet) have an EV code-signing certificate. Two clicks and you're through.",
  "dl.fadeOut": "FADE OUT.",
  "dl.end": "END",

  // ===================== Route: IDEEN =====================
  "ideas.h": "Ideas",
  "ideas.sub":
    "Collect what you want to write next - and turn it into a script the moment the idea has legs.",
  "ideas.meta": "{open} open · {fresh} new this week",
  "ideas.input.placeholder": "What do you want to write next?",
  "ideas.input.hint": "⌘I works from anywhere",
  "ideas.input.note": "Note",
  "ideas.filter.placeholder": "Filter",
  "ideas.chip.all": "All",
  "ideas.chip.none": "No folder",
  "ideas.folder.tutorials": "Tutorials",
  "ideas.folder.compare": "Comparisons",
  "ideas.folder.reels": "Reels",
  "ideas.group.week": "This week",
  "ideas.group.older": "Older",
  "ideas.detail.top": "Idea · 2h ago",
  "ideas.detail.created": "Created",
  "ideas.detail.createdValue": "today, 6:14 AM",
  "ideas.detail.delete": "Delete",
  "ideas.keys.select": "select",
  "ideas.keys.open": "expand",
  "ideas.keys.start": "start as script",
  "ideas.detail.start": "Start as script",
  "ideas.hint.before":
    "captures an idea from anywhere in the app, even in focus mode. Type, Enter, done. The ideas page itself is built for 50+ ideas: folder chips, a filter and every idea opens right inside the list.",

  // Idea samples
  "ideas.sample.tutorial.title": "Tutorial: From empty cursor to finished script in 5 minutes",
  "ideas.sample.tutorial.body":
    "Screen recording with a stopwatch. Turn on quick mode, just type, export - done. Proof, not a claim.",
  "ideas.sample.tutorial.age": "2h ago",
  "ideas.sample.fd.title": "Why I stopped using Final Draft for TikTok",
  "ideas.sample.fd.body":
    "License, screenplay layout, Courier 12pt. All built for 90-minute movies. I need 60 seconds.",
  "ideas.sample.fd.age": "4h ago",
  "ideas.sample.word.title": "A moment of silence for Word power users",
  "ideas.sample.word.body":
    "Click, click, click, click. Manual indent. Character name bold, new line, centered. Tab, tab, tab.",
  "ideas.sample.word.age": "6h ago",
  "ideas.sample.noai.title": "ScriptZ without AI - on purpose",
  "ideas.sample.noai.body":
    "Other tools write the script for you. We write nothing for you. You're the creator, not the model.",
  "ideas.sample.noai.age": "9h ago",
  "ideas.sample.reel.title": "Reel: quick mode explained in 30 seconds",
  "ideas.sample.reel.body":
    "Two-hander dialog. Hit Enter. Speaker switches automatically. That's it.",
  "ideas.sample.reel.age": "14h ago",
  "ideas.sample.length.title": "How long can a reel be?",
  "ideas.sample.length.body":
    "A target range instead of gut feeling: 0:45 to 1:05. Below it a quiet hint, above it the red pen. The timeline shows where to cut.",
  "ideas.sample.length.age": "9d ago",

  // ===================== Footer =====================
  "footer.col.project": "Project",
  "footer.col.legal": "Legal",
  "footer.col.contact": "Contact",
  "footer.link.github": "GitHub",
  "footer.link.releases": "Releases",
  "footer.link.imprint": "Imprint",
  "footer.link.privacy": "Privacy",
  "footer.link.email": "Email",
  "footer.about.eyebrow": "ABOUT SCRIPTZ",
  "footer.about.body":
    "A script editor for content creators that gets out of your way. Format happens as you type, characters are auto-detected, quick mode saves two keystrokes per speaker switch. All local, all in a SQLite file on your computer. No cloud, no account, no AI.",
  "footer.about.os.mac": "macOS 13+ · Open Source",
  "footer.about.os.win": "Windows 10+ · Open Source",

  // ===================== Runtime pill =====================

  "runpill.label": "Runtime",
  "runpill.title":
    "How long this page takes to say out loud at 210 words per minute - the way ScriptZ estimates a script's length.",

  // ===================== Language toggle =====================
  "lang.toggle.aria": "Switch language",
  "lang.toggle.de": "DE",
  "lang.toggle.en": "EN",

  // ===================== Mobile navigation =====================
  "mobilenav.brand": "ScriptZ",
  "mobilenav.open.aria": "Open menu",
  "mobilenav.close.aria": "Close menu",
  "mobilenav.close.label": "Close",
  "mobilenav.section.pages": "Pages",
  "mobilenav.section.legal": "Legal",
  "mobilenav.section.language": "Language",
  "mobilenav.section.project": "Project",

  // ===================== Page meta =====================
  // Home (`/en`) - the dominant brand entry.
  "meta.title": "ScriptZ - the script editor for content creators",
  "meta.description":
    "Write, don't format. From idea to finished script in minutes. Local, free, open source. For TikTok, Reels and YouTube Shorts.",
  // Why-route (`/en/why-scriptz`)
  "meta.warum.title": "Why ScriptZ - script editor without screenplay corset | for Reels and Shorts",
  "meta.warum.description":
    "ScriptZ is built for content creators, not screenwriters. Format happens as you type, characters are detected, a target range shows when the script runs long. For TikTok, Reels and YouTube Shorts.",
  // Quick-mode route (`/en/quick-mode`)
  "meta.quickmodus.title": "Quick mode - two-hander workflow for Reels and Shorts | ScriptZ",
  "meta.quickmodus.description":
    "ScriptZ quick mode writes two-hander dialog automatically: Enter jumps to the next speaker. Saves a minute per script - no Tab, no typing speaker names.",
  // No-AI route (`/en/no-ai`)
  "meta.noai.title": "Script editor without AI - the no-AI manifesto | ScriptZ",
  "meta.noai.description":
    "ScriptZ has no AI built in - on purpose. No suggestions, no „improve\" button, no cloud upload. Your voice stays yours, your script stays local.",
  // Compare route (`/en/compare`)
  "meta.compare.title": "ScriptZ vs. Final Draft, Notion, ChatGPT - the honest comparison",
  "meta.compare.description":
    "ScriptZ as a free Final Draft alternative for TikTok, Reels and Shorts. What we can do that Word, Notion, Final Draft, ChatGPT and Apple Notes can't - and vice versa.",
  // Download route (`/en/download`)
  "meta.download.title": "Download ScriptZ free - macOS and Windows | Open Source",
  "meta.download.description":
    "Script editor for content creators. Free, local, open source. macOS 13+ (.dmg) or Windows 10+ (.exe). No account, no trackers, no AI.",
  // Ideas route (`/en/ideas`)
  "meta.ideas.title": "Ideas - what you write next | ScriptZ",
  "meta.ideas.description":
    "Collect script ideas for TikTok, Reels and YouTube Shorts, sorted by folder and captured from anywhere with ⌘I. One shortcut turns them into a script. Offline, no account, in the app and in the browser.",
  "meta.ogLocale": "en_US",

  // ===================== Blog =====================
  "footer.link.blog": "Blog",
  "footer.link.rss": "RSS feed",

  "blog.toolbar.title.index": "Blog - notes from the script editor",
  "blog.toolbar.title.post": "Blog",

  "blog.index.eyebrow": "BLOG // SCRIPTZ",
  "blog.index.h1": "Notes from the script editor.",
  "blog.index.lead":
    "Thoughts, release stories and the occasional trick from working with ScriptZ. Set in script format - just like the editor itself.",
  "blog.index.empty": "No posts yet. Writing starts soon.",
  "blog.index.rss.label": "Subscribe to RSS feed",

  "blog.readingTime_one": "{n} min read",
  "blog.readingTime_other": "{n} min read",
  "blog.publishedOn": "Published {date}",
  "blog.updatedOn": "Updated {date}",
  "blog.author.by": "by {name}",

  "blog.back": "← Back to the blog",
  "blog.share.h": "Share",

  "blog.rss.title": "ScriptZ Blog",
  "blog.rss.description":
    "Notes from the script editor for content creators. Releases, workflow tricks and small stories.",

  "meta.blog.title": "Blog - notes from the script editor | ScriptZ",
  "meta.blog.description":
    "The ScriptZ blog: release stories, workflow tips for Reels and Shorts, and notes from the day-to-day of a script editor for content creators.",
};
