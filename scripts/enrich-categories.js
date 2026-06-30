/**
 * Enrich every category with rich website content:
 *   - description            (shows in the category hero + section-page cards)
 *   - meta_title / meta_description / meta_keywords  (SEO)
 *   - content (JSONB)        { intro, highlights[], specifications[], useCases[], faqs[] }
 *                            (rendered by the new CategoryContent section)
 *
 *   Preview (default — no writes):   node scripts/enrich-categories.js
 *   Apply  (writes to live DB):      EXECUTE=1 node scripts/enrich-categories.js
 *
 * Idempotent: re-running just re-applies the same content by slug.
 */
require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = process.env.EXECUTE !== '1';

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 30000,
  keepAlive: true,
});

// Neon auto-suspends; retry the first query until the instance wakes.
async function query(text, params, tries = 6) {
  for (let i = 1; i <= tries; i++) {
    try {
      return await pool.query(text, params);
    } catch (e) {
      if (i === tries) throw e;
      console.log(`  …db not ready (${e.code || e.message}); retry ${i}/${tries - 1}`);
    }
  }
}

const DIM = { A4: '210 × 297 mm', A5: '148 × 210 mm', A6: '105 × 148 mm', B5: '176 × 250 mm' };

// Standard FAQs reused across categories (safe, generic — no invented hard specs).
const baseFaqs = (label) => [
  {
    q: `Can the ${label} be customised with our company branding?`,
    a: 'Yes. We offer logo foil-stamping, blind embossing, screen and UV printing, plus custom cover materials, colours and ribbons to match your brand.',
  },
  {
    q: 'Is there a minimum order quantity?',
    a: 'These are produced for bulk and corporate orders. Minimum quantities and pricing slabs are shared on enquiry — get in touch with your requirement.',
  },
  {
    q: 'What is the typical production lead time?',
    a: 'Lead time depends on quantity and the level of customisation. Once your design and quantity are confirmed, we share an exact dispatch timeline.',
  },
];

// label, value pairs — dimensions are factual; the rest are framed as options to stay accurate.
const diarySpecs = (size, layout) => [
  { label: 'Format', value: `${size} ${layout} diary` },
  { label: 'Dimensions', value: `${DIM[size]} (${size})` },
  { label: 'Page layout', value: layout === 'Daily' ? 'One day per page, dated with planner' : 'Week-to-view spread, dated' },
  { label: 'Cover options', value: 'Leatherette, PU, fabric & designer finishes' },
  { label: 'Binding', value: 'Sewn / wiro options — opens flat' },
  { label: 'Personalisation', value: 'Logo foiling, embossing, screen & UV print' },
];

const notebookSpecs = (size, extra) => [
  { label: 'Format', value: `${size ? size + ' ' : ''}Notebook` },
  ...(size ? [{ label: 'Dimensions', value: `${DIM[size]} (${size})` }] : []),
  { label: 'Pages', value: 'Ruled / plain — as specified' },
  ...(extra ? [{ label: 'Binding', value: extra }] : []),
  { label: 'Cover options', value: 'Premium leatherette, PU & board finishes' },
  { label: 'Personalisation', value: 'Logo foiling, embossing & printing' },
];

// slug -> content
const DATA = {
  // ---------------- DIARIES ----------------
  'a5-daily': {
    description: 'Our most popular executive diary — a full page for every day in the handy A5 (148 × 210 mm) format, with 80+ cover styles to choose from.',
    metaTitle: 'A5 Daily Diaries — Day-Per-Page Executive Diaries | Goodwill Printers',
    metaDescription: 'Premium A5 day-per-page diaries (148 × 210 mm) in 80+ cover styles. Custom branding, foiling and embossing for corporate gifting. Made by Goodwill Printers.',
    keywords: 'A5 daily diary, day per page diary, executive diary, 2027 diary, corporate diary, custom diary, Goodwill Printers',
    intro:
      'The A5 Daily is our best-selling diary — compact enough to carry, with a dedicated page for every single day so nothing slips through the cracks. It is the format most corporates choose for year-end gifting.\n\nChoose from more than eighty cover designs, from understated leatherette to bold designer finishes, then personalise with your logo for a gift that stays on the desk all year.',
    highlights: [
      'A full, dated page for every day of the year',
      '80+ cover styles — the widest A5 range we offer',
      'Comfortable 148 × 210 mm size — desk-friendly yet portable',
      'Custom logo foiling, embossing and printing',
      'Ribbon marker, rounded corners and planner pages',
    ],
    useCases: ['Corporate year-end gifting', 'Executive daily planning', 'Client and employee giveaways', 'Branded promotional diaries'],
    specs: diarySpecs('A5', 'Daily'),
  },
  'b5-daily': {
    description: 'A generously sized B5 (176 × 250 mm) day-per-page diary that gives professionals extra room to plan, note and schedule.',
    metaTitle: 'B5 Daily Diaries — Large Day-Per-Page Diaries | Goodwill Printers',
    metaDescription: 'Spacious B5 day-per-page diaries (176 × 250 mm) with room to plan in detail. Custom covers and branding for corporate gifting from Goodwill Printers.',
    keywords: 'B5 daily diary, large diary, day per page, executive diary, corporate diary, custom diary, Goodwill Printers',
    intro:
      'The B5 Daily steps up from A5 with a larger writing area, giving each day more space for appointments, notes and to-dos. It is the natural choice for planners who like to keep everything in one place.\n\nPaired with a premium branded cover, it makes a substantial, professional corporate gift.',
    highlights: [
      'Larger 176 × 250 mm page — more room per day',
      'One dated page for every day of the year',
      'Premium cover finishes with custom branding',
      'Lay-flat binding and ribbon marker',
      'Ideal for detailed daily planning',
    ],
    useCases: ['Senior management gifting', 'Detailed daily planning', 'Premium corporate diaries', 'Desk diaries'],
    specs: diarySpecs('B5', 'Daily'),
  },
  'a4-daily': {
    description: 'The largest day-per-page format — A4 (210 × 297 mm) diaries built for desks, reception areas and heavy daily planning.',
    metaTitle: 'A4 Daily Diaries — Large Desk Diaries | Goodwill Printers',
    metaDescription: 'Large A4 day-per-page desk diaries (210 × 297 mm) for offices and reception areas. Custom branding available from Goodwill Printers.',
    keywords: 'A4 daily diary, desk diary, large day per page diary, office diary, corporate diary, Goodwill Printers',
    intro:
      'The A4 Daily is our most spacious day-per-page diary — a true desk diary with ample room to log a full day of meetings, calls and notes.\n\nIts size makes it a commanding presence on any desk or reception counter, and a premium branded option for offices.',
    highlights: [
      'Full A4 (210 × 297 mm) day-per-page layout',
      'Maximum writing space per day',
      'Perfect as a desk or reception diary',
      'Custom cover and logo branding',
      'Durable lay-flat binding',
    ],
    useCases: ['Office and reception desks', 'Heavy daily scheduling', 'Front-desk visitor logging', 'Corporate desk gifting'],
    specs: diarySpecs('A4', 'Daily'),
  },
  'a4-weekly': {
    description: 'Week-to-view A4 (210 × 297 mm) diaries that lay out the full week at a glance — ideal for scheduling and team planning.',
    metaTitle: 'A4 Weekly Diaries — Week-To-View Planners | Goodwill Printers',
    metaDescription: 'A4 week-to-view diaries (210 × 297 mm) that show the whole week at a glance. Great for planning and scheduling. Custom branding from Goodwill Printers.',
    keywords: 'A4 weekly diary, week to view, weekly planner, office planner, corporate diary, Goodwill Printers',
    intro:
      'The A4 Weekly opens to show the entire week across a single spread, making it easy to see commitments at a glance and plan ahead.\n\nThe large format suits teams, project leads and anyone who thinks in weeks rather than days.',
    highlights: [
      'Week-to-view spread — the whole week at a glance',
      'Large A4 (210 × 297 mm) planning area',
      'Great for scheduling and forward planning',
      'Premium covers with custom branding',
      'Lay-flat binding for easy writing',
    ],
    useCases: ['Team and project planning', 'Weekly scheduling', 'Office desk planners', 'Corporate gifting'],
    specs: diarySpecs('A4', 'Weekly'),
  },
  'a6-weekly': {
    description: 'Compact, pocket-friendly A6 (105 × 148 mm) week-to-view diaries that keep the whole week in your hand.',
    metaTitle: 'A6 Weekly Diaries — Pocket Week-To-View Diaries | Goodwill Printers',
    metaDescription: 'Pocket-sized A6 week-to-view diaries (105 × 148 mm). Lightweight planning on the go with custom branding from Goodwill Printers.',
    keywords: 'A6 weekly diary, pocket diary, week to view, small diary, corporate diary, Goodwill Printers',
    intro:
      'The A6 Weekly is our most portable diary — slim enough for a pocket or handbag, yet it still shows the full week across each spread.\n\nA practical, affordable corporate giveaway that recipients actually carry every day.',
    highlights: [
      'Pocket-sized A6 (105 × 148 mm) format',
      'Week-to-view layout in a compact body',
      'Lightweight and easy to carry',
      'Cost-effective for large gifting runs',
      'Custom logo branding available',
    ],
    useCases: ['Mass promotional gifting', 'On-the-go planning', 'Pocket and handbag diaries', 'Event giveaways'],
    specs: diarySpecs('A6', 'Weekly'),
  },

  // ---------------- NOTEBOOKS ----------------
  'a5-notebooks': {
    description: 'Versatile A5 (148 × 210 mm) notebooks for meetings, journaling and everyday notes, in a wide range of premium covers.',
    metaTitle: 'A5 Notebooks — Premium Branded Notebooks | Goodwill Printers',
    metaDescription: 'Premium A5 notebooks (148 × 210 mm) for meetings, journaling and notes. Wide cover range with custom branding from Goodwill Printers.',
    keywords: 'A5 notebook, branded notebook, corporate notebook, journal, custom notebook, Goodwill Printers',
    intro:
      'The A5 Notebook is the everyday workhorse — the right size for meetings, journaling and quick notes, and compact enough to go everywhere.\n\nAvailable in dozens of cover finishes and fully brandable, it is a dependable corporate gift and merchandise staple.',
    highlights: [
      'Handy A5 (148 × 210 mm) everyday size',
      'Wide selection of premium cover finishes',
      'Ruled or plain pages as specified',
      'Custom logo foiling and embossing',
      'Ideal for gifting and merchandise',
    ],
    useCases: ['Meeting notes', 'Corporate gifting & merchandise', 'Journaling', 'Conferences and events'],
    specs: notebookSpecs('A5', 'Sewn / wiro options'),
  },
  'b5-notebooks': {
    description: 'Spacious B5 (176 × 250 mm) notebooks with extra writing area for detailed notes, study and project work.',
    metaTitle: 'B5 Notebooks — Large Premium Notebooks | Goodwill Printers',
    metaDescription: 'Large B5 notebooks (176 × 250 mm) with extra room for detailed notes and project work. Custom branding from Goodwill Printers.',
    keywords: 'B5 notebook, large notebook, branded notebook, corporate notebook, custom notebook, Goodwill Printers',
    intro:
      'The B5 Notebook offers a larger canvas than A5 — well suited to detailed note-taking, study and project work where extra space matters.\n\nPremium covers and full branding make it a standout gift or in-house tool.',
    highlights: [
      'Larger B5 (176 × 250 mm) writing area',
      'Great for detailed notes and projects',
      'Premium cover materials',
      'Ruled or plain pages as specified',
      'Custom branding and finishing',
    ],
    useCases: ['Detailed note-taking', 'Study and research', 'Project and design work', 'Premium corporate gifting'],
    specs: notebookSpecs('B5', 'Sewn / wiro options'),
  },
  'swiss': {
    description: 'Swiss-binding notebooks with an exposed, lay-flat spine that opens completely flat — a designer favourite.',
    metaTitle: 'Swiss Binding Notebooks — Lay-Flat Designer Notebooks | Goodwill Printers',
    metaDescription: 'Swiss-bound notebooks with an exposed spine that opens fully flat. A premium, designer-grade notebook from Goodwill Printers.',
    keywords: 'swiss binding notebook, lay flat notebook, exposed spine, designer notebook, premium notebook, Goodwill Printers',
    intro:
      'Swiss binding leaves the spine elegantly exposed and lets the notebook open a full 180°, so pages lie perfectly flat while you write.\n\nThe construction is as much a design statement as a function — a refined choice for premium gifting.',
    highlights: [
      'Exposed-spine Swiss binding',
      'Opens fully flat at 180°',
      'Premium, designer-grade construction',
      'Distinctive, gift-worthy finish',
      'Custom branding available',
    ],
    useCases: ['Premium gifting', 'Design-led brands', 'Sketching and journaling', 'Executive notebooks'],
    specs: notebookSpecs(null, 'Swiss (exposed spine), lay-flat'),
  },
  'usb-folder': {
    description: 'Notebook-and-folder sets with an integrated USB and organiser pockets — a smart corporate companion.',
    metaTitle: 'USB Folders — Notebook & Organiser Sets | Goodwill Printers',
    metaDescription: 'Corporate USB folders combining a notebook, organiser pockets and an integrated USB drive. Custom branding from Goodwill Printers.',
    keywords: 'USB folder, notebook organiser, corporate folder, USB notebook set, executive folder, Goodwill Printers',
    intro:
      'The USB Folder brings a notebook, document pockets and an integrated USB drive together in one structured organiser.\n\nIt is a practical, all-in-one executive companion that looks the part in any meeting.',
    highlights: [
      'Integrated USB drive',
      'Notebook plus organiser pockets',
      'Slots for cards, pen and documents',
      'Structured, premium cover',
      'Fully brandable for corporates',
    ],
    useCases: ['Executive gifting', 'Conference kits', 'Onboarding welcome sets', 'Client gifting'],
    specs: notebookSpecs(null, 'Folder-style with USB & pockets'),
  },
  'trump-folder': {
    description: 'Premium folder-style notebooks with a structured cover and document pockets for the boardroom.',
    metaTitle: 'Trump Folders — Executive Folder Notebooks | Goodwill Printers',
    metaDescription: 'Structured executive folder notebooks with document pockets and a premium cover. Custom branding from Goodwill Printers.',
    keywords: 'trump folder, executive folder, conference folder, padfolio, corporate folder, Goodwill Printers',
    intro:
      'The Trump Folder is a structured, boardroom-ready folder notebook — a firm cover, organised interior and space for documents, cards and a pen.\n\nIt projects authority and keeps essentials tidy in one place.',
    highlights: [
      'Structured, firm-cover folder',
      'Notepad with document and card pockets',
      'Pen loop and organiser interior',
      'Boardroom-ready presentation',
      'Custom branding and finishes',
    ],
    useCases: ['Boardroom and meetings', 'Executive gifting', 'Conference and event kits', 'Sales presentations'],
    specs: notebookSpecs(null, 'Folder-style with pockets'),
  },
  'wiro': {
    description: 'Twin-wire (wiro) bound notebooks that fold back 360° and lay perfectly flat for easy writing.',
    metaTitle: 'Wiro Notebooks — Twin-Wire Spiral Notebooks | Goodwill Printers',
    metaDescription: 'Wiro (twin-wire) bound notebooks that fold back fully and lay flat. Practical, brandable notebooks from Goodwill Printers.',
    keywords: 'wiro notebook, spiral notebook, twin wire, wire bound notebook, corporate notebook, Goodwill Printers',
    intro:
      'Wiro binding uses a twin-wire spine so the notebook folds all the way back on itself and lies flat on the desk — practical for note-takers who like to write on one page at a time.\n\nDurable and easy to use, with plenty of cover options.',
    highlights: [
      'Twin-wire (wiro) binding',
      'Folds back a full 360°',
      'Lies completely flat',
      'Durable everyday construction',
      'Custom covers and branding',
    ],
    useCases: ['Everyday note-taking', 'Training and workshops', 'Students and professionals', 'Promotional notebooks'],
    specs: notebookSpecs(null, 'Wiro (twin-wire)'),
  },
  'york': {
    description: 'The York range — refined notebooks with a classic finish for executives and gifting.',
    metaTitle: 'York Notebooks — Classic Executive Notebooks | Goodwill Printers',
    metaDescription: 'The York range of refined, classic-finish executive notebooks. Premium covers and custom branding from Goodwill Printers.',
    keywords: 'york notebook, executive notebook, classic notebook, premium notebook, corporate gifting, Goodwill Printers',
    intro:
      'The York range pairs a classic, understated cover with quality paper for a notebook that feels considered and professional.\n\nA dependable choice when you want timeless rather than trendy.',
    highlights: [
      'Classic, refined cover finish',
      'Quality paper for everyday writing',
      'Understated executive look',
      'Premium gifting option',
      'Custom branding available',
    ],
    useCases: ['Executive gifting', 'Everyday professional use', 'Corporate merchandise', 'Client gifts'],
    specs: notebookSpecs(null, 'Premium bound'),
  },

  // ---------------- ORGANIZERS ----------------
  'gp-43': {
    description: 'The GP-43 organiser — a daily planning system with structured pages and an elegant, refillable-style cover.',
    metaTitle: 'GP-43 Organisers — Daily Planning Organisers | Goodwill Printers',
    metaDescription: 'GP-43 daily organisers with structured planning pages and an elegant cover. Premium organisers with custom branding from Goodwill Printers.',
    keywords: 'GP-43 organiser, daily organiser, planner, executive organiser, corporate organiser, Goodwill Printers',
    intro:
      'The GP-43 is a complete daily organiser — structured planning pages housed in a polished cover that keeps your schedule, notes and contacts in one elegant system.\n\nA professional-grade planner that doubles as a premium gift.',
    highlights: [
      'Structured daily planning pages',
      'Elegant, executive cover',
      'Keeps schedule, notes and contacts together',
      'Premium finishing options',
      'Custom logo branding',
    ],
    useCases: ['Executive daily planning', 'Corporate gifting', 'Professional organisation', 'Premium giveaways'],
    specs: [
      { label: 'Format', value: 'GP-43 daily organiser' },
      { label: 'Page layout', value: 'Structured daily planner with notes' },
      { label: 'Cover', value: 'Elegant executive finish' },
      { label: 'Extras', value: 'Contacts, notes & planning sections' },
      { label: 'Personalisation', value: 'Logo foiling & embossing' },
    ],
  },
  'one-day-a-page': {
    description: 'Organisers laid out with a dedicated page for each day, giving you space to plan every appointment and task.',
    metaTitle: 'One Day A Page Organisers — Daily Planners | Goodwill Printers',
    metaDescription: 'One-day-a-page organisers with a full page for every day to plan appointments and tasks. Custom branding from Goodwill Printers.',
    keywords: 'one day a page, daily organiser, day per page planner, executive planner, corporate organiser, Goodwill Printers',
    intro:
      'The One Day A Page organiser gives each day its own full page, so there is room for every appointment, task and note without crowding.\n\nIdeal for busy professionals who plan in detail, day by day.',
    highlights: [
      'A full page dedicated to every day',
      'Plenty of room for tasks and appointments',
      'Structured planner layout',
      'Premium cover with custom branding',
      'Professional daily planning system',
    ],
    useCases: ['Detailed daily planning', 'Busy executives', 'Corporate gifting', 'Professional organisation'],
    specs: [
      { label: 'Format', value: 'Day-per-page organiser' },
      { label: 'Page layout', value: 'One full page per day' },
      { label: 'Cover', value: 'Premium executive finish' },
      { label: 'Personalisation', value: 'Logo foiling & embossing' },
    ],
  },

  // ---------------- CORPORATE GIFTS ----------------
  'travelling-kit': {
    description: 'Premium travel kits that bundle the essentials — a polished, practical corporate gift for people on the move.',
    metaTitle: 'Travelling Kits — Premium Corporate Travel Gifts | Goodwill Printers',
    metaDescription: 'Premium corporate travelling kits bundling travel essentials in one polished set. Custom branding from Goodwill Printers.',
    keywords: 'travelling kit, travel gift set, corporate gift, executive travel kit, branded travel kit, Goodwill Printers',
    intro:
      'Our Travelling Kits gather the essentials a frequent traveller needs into one smart, branded set — practical, presentable and genuinely useful.\n\nA corporate gift that gets carried far beyond the office.',
    highlights: [
      'Curated travel essentials in one set',
      'Premium, presentation-ready packaging',
      'Practical and genuinely useful',
      'Fully brandable for your company',
      'Great for executives and clients',
    ],
    useCases: ['Executive gifting', 'Client appreciation', 'Frequent travellers', 'Premium corporate gifts'],
    specs: [
      { label: 'Type', value: 'Corporate travel gift set' },
      { label: 'Contents', value: 'Curated travel essentials' },
      { label: 'Presentation', value: 'Premium gift packaging' },
      { label: 'Personalisation', value: 'Logo branding on set & pack' },
    ],
  },
  'folders': {
    description: 'Professional document and conference folders with notepad, card and pen slots — branded for your business.',
    metaTitle: 'Corporate Folders — Conference & Document Folders | Goodwill Printers',
    metaDescription: 'Professional conference and document folders with notepad, card and pen slots. Custom branding from Goodwill Printers.',
    keywords: 'corporate folder, conference folder, document folder, padfolio, branded folder, Goodwill Printers',
    intro:
      'Our Folders keep documents, notes and cards organised in one professional package — a staple for meetings, conferences and onboarding.\n\nBranded with your logo, they make every handout look considered.',
    highlights: [
      'Notepad with document pockets',
      'Card and pen slots',
      'Professional, structured covers',
      'Ideal for meetings and conferences',
      'Custom logo branding',
    ],
    useCases: ['Conferences and events', 'Client meetings', 'Employee onboarding', 'Sales kits'],
    specs: [
      { label: 'Type', value: 'Document / conference folder' },
      { label: 'Interior', value: 'Notepad, document & card pockets' },
      { label: 'Extras', value: 'Pen loop' },
      { label: 'Cover', value: 'Premium leatherette / PU' },
      { label: 'Personalisation', value: 'Logo foiling & embossing' },
    ],
  },
  'pen-holder-vogue': {
    description: 'Desk pen holders and the Vogue gifting range that add a premium touch to any workspace or gift set.',
    metaTitle: 'Pen Holders & Vogue Range — Desk Gifts | Goodwill Printers',
    metaDescription: 'Premium desk pen holders and the Vogue gifting range to elevate any workspace or corporate gift set. Custom branding from Goodwill Printers.',
    keywords: 'pen holder, desk organiser, vogue gift set, corporate desk gift, branded desk accessory, Goodwill Printers',
    intro:
      'The Pen Holder & Vogue range brings a premium, finishing touch to the desk — refined accessories that work on their own or as part of a larger gift set.\n\nA small detail that signals quality.',
    highlights: [
      'Premium desk pen holders',
      'Vogue gifting range',
      'Elevates any workspace or gift set',
      'Quality materials and finish',
      'Custom branding available',
    ],
    useCases: ['Desk accessories', 'Gift-set components', 'Corporate gifting', 'Office merchandise'],
    specs: [
      { label: 'Type', value: 'Desk pen holder / gift accessory' },
      { label: 'Range', value: 'Vogue premium gifting' },
      { label: 'Finish', value: 'Premium materials' },
      { label: 'Personalisation', value: 'Logo branding available' },
    ],
  },
  'atm-card-holders': {
    description: 'Slim, smart card and ATM holders in premium finishes — a compact, high-utility corporate giveaway.',
    metaTitle: 'ATM & Card Holders — Slim Card Cases | Goodwill Printers',
    metaDescription: 'Slim ATM and card holders in premium finishes — a compact, high-utility corporate gift. Custom branding from Goodwill Printers.',
    keywords: 'ATM card holder, card holder, card case, corporate gift, branded card holder, Goodwill Printers',
    intro:
      'Our ATM & Card Holders keep cards slim, safe and organised in a premium little case that fits any pocket.\n\nLow cost, high utility and carried every day — an efficient branded giveaway.',
    highlights: [
      'Slim, pocket-friendly design',
      'Holds ATM, credit and business cards',
      'Premium materials and finish',
      'Carried and used daily',
      'Cost-effective branded giveaway',
    ],
    useCases: ['Mass corporate giveaways', 'Event gifting', 'Loyalty and promo gifts', 'Everyday carry'],
    specs: [
      { label: 'Type', value: 'ATM / card holder' },
      { label: 'Capacity', value: 'Cards & ATM/credit cards' },
      { label: 'Finish', value: 'Premium leatherette / PU' },
      { label: 'Personalisation', value: 'Logo foiling & embossing' },
    ],
  },
  'guest-book': {
    description: 'Elegant guest books for hotels, events and offices — a refined way to welcome and record your visitors.',
    metaTitle: 'Guest Books — Premium Visitor & Event Registers | Goodwill Printers',
    metaDescription: 'Elegant guest books and visitor registers for hotels, events and offices. Premium covers with custom branding from Goodwill Printers.',
    keywords: 'guest book, visitor register, hotel guest book, event guest book, signing book, Goodwill Printers',
    intro:
      'Our Guest Books bring a sense of occasion to welcoming visitors — premium covers and quality pages that look the part in a hotel lobby, event or boardroom.\n\nA refined, lasting record of who came through your doors.',
    highlights: [
      'Elegant, premium covers',
      'Quality signing pages',
      'Perfect for hotels, events and offices',
      'A refined welcome and record',
      'Custom branding and personalisation',
    ],
    useCases: ['Hotels and hospitality', 'Events and exhibitions', 'Office reception', 'Weddings and functions'],
    specs: [
      { label: 'Type', value: 'Guest book / visitor register' },
      { label: 'Pages', value: 'Premium signing pages' },
      { label: 'Cover', value: 'Premium leatherette / hardbound' },
      { label: 'Personalisation', value: 'Logo foiling & embossing' },
    ],
  },
  'passports': {
    description: 'Premium passport holders that protect travel documents in style — a thoughtful executive and travel gift.',
    metaTitle: 'Passport Holders — Premium Travel Document Covers | Goodwill Printers',
    metaDescription: 'Premium passport holders that protect travel documents in style. A thoughtful executive travel gift with custom branding from Goodwill Printers.',
    keywords: 'passport holder, passport cover, travel document holder, corporate travel gift, branded passport holder, Goodwill Printers',
    intro:
      'Our Passport Holders keep travel documents protected and to hand in a premium case that looks as good as it is practical.\n\nA thoughtful gift for travelling executives and a natural pairing with our travel kits.',
    highlights: [
      'Protects passport and travel documents',
      'Premium materials and finish',
      'Slim, travel-friendly design',
      'Pairs well with travelling kits',
      'Custom branding available',
    ],
    useCases: ['Executive travel gifting', 'Frequent travellers', 'Client gifts', 'Travel kit pairing'],
    specs: [
      { label: 'Type', value: 'Passport holder' },
      { label: 'Capacity', value: 'Passport, cards & boarding pass' },
      { label: 'Finish', value: 'Premium leatherette / PU' },
      { label: 'Personalisation', value: 'Logo foiling & embossing' },
    ],
  },
};

(async () => {
  console.log(`\n${DRY_RUN ? '🔎 DRY RUN — no DB writes' : '🚀 EXECUTE — writing category content to live DB'}\n`);

  // Ensure the content column exists (additive, safe).
  if (!DRY_RUN) {
    await query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS content JSONB`);
    console.log('Ensured categories.content column exists.\n');
  } else {
    console.log('Would run: ALTER TABLE categories ADD COLUMN IF NOT EXISTS content JSONB\n');
  }

  const existing = await query(
    `SELECT c.slug, s.slug AS section FROM categories c JOIN sections s ON c.section_id=s.id ORDER BY s.sort_order, c.sort_order`
  );
  const known = new Set(existing.rows.map((r) => r.slug));

  let updated = 0;
  const missingInDb = [];
  for (const [slug, d] of Object.entries(DATA)) {
    if (!known.has(slug)) { missingInDb.push(slug); continue; }
    const content = {
      intro: d.intro,
      highlights: d.highlights,
      specifications: d.specs,
      useCases: d.useCases,
      faqs: [...baseFaqs(d.metaTitle.split(' —')[0])],
    };

    console.log(`• ${slug}`);
    console.log(`    description : ${d.description}`);
    console.log(`    meta_title  : ${d.metaTitle}`);
    console.log(`    breakdown   : ${content.highlights.length} highlights · ${content.specifications.length} specs · ${content.useCases.length} use-cases · ${content.faqs.length} FAQs`);

    if (!DRY_RUN) {
      await query(
        `UPDATE categories
         SET description=$1, meta_title=$2, meta_description=$3, meta_keywords=$4, content=$5, updated_at=CURRENT_TIMESTAMP
         WHERE slug=$6`,
        [d.description, d.metaTitle, d.metaDescription, d.keywords, JSON.stringify(content), slug]
      );
    }
    updated++;
  }

  const notInData = [...known].filter((s) => !DATA[s]);
  console.log('\n────────────────────────────────────────');
  console.log(`Categories ${DRY_RUN ? 'to update' : 'updated'} : ${updated}/${known.size}`);
  if (notInData.length) console.log(`No content written for (not in dataset): ${notInData.join(', ')}`);
  if (missingInDb.length) console.log(`In dataset but not found in DB: ${missingInDb.join(', ')}`);
  console.log(DRY_RUN ? '\nDry run only. Re-run with EXECUTE=1 to apply.' : '\n✅ Done.');

  await pool.end();
  process.exit(0);
})().catch(async (e) => {
  console.error('FATAL:', e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
