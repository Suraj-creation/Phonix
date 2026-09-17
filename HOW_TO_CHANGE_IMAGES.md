# Phoenix Club — How to Add, Change, or Replace Images

This guide explains how images work across the website, how to swap existing photos, and how to add new member or event cards.

---

## 1. Where Images Are Stored

All images are neatly organized in the local `images/` directory:

```
images/
├── team/            # Photos of Core Council and Committee Members
├── events/          # Photos of Campus Events, Workshops, and Galleries
├── logos/           # Phoenix Club & Navrachana University Logos
└── sponsors/        # Partner & Sponsor SVG Logos
```

**100% Offline & Self-Contained**: The website no longer depends on any external image hosting. All images are bundled right inside your project folder and will work anywhere, offline or online.

---

## 2. Changing an Existing Image (2 Easy Ways)

### Method A: Overwrite the File (No Code Changes Needed!)
If you want to replace a photo with an updated one:
1. Save your new photo with the exact same name as the existing file (e.g., `images/team/president-tannushree-shah.png` or `images/team/technical-aditya-nath.jpg`).
2. Replace/overwrite the old file.
3. Refresh your browser (`Ctrl + F5`) — the new photo will appear immediately!

---

### Method B: Add a New Image File & Update the HTML
1. Place your new photo inside `images/team/` or `images/events/` (e.g. `images/team/rahul-verma.jpg`).
2. Open the respective HTML file (e.g., `core-team.html` or `committee.html`) in your code editor.
3. Find the card and update the `src` attribute:
```html
<div class="member-photo">
  <img src="images/team/rahul-verma.jpg" alt="Rahul Verma - Technical Coordinator" class="lightbox-trigger" />
</div>
```

---

## 3. Recommended Image Dimensions & Framing

The CSS is designed so that **any photo of any resolution or aspect ratio** will fit inside the cards without stretching, squishing, or breaking the grid.

| Image Type | Recommended Aspect Ratio | Recommended Resolution |
| :--- | :--- | :--- |
| **Member Portraits** | Portrait (3:4 or 4:5) | `600 × 800 px` |
| **Event Cards & Highlights** | Landscape (16:9 or 4:3) | `1200 × 800 px` |
| **Carousel Hero Slides** | Widescreen (16:9) | `1600 × 900 px` |

### How Face Alignment Works (`object-fit: cover`)
- All member cards automatically use `object-fit: cover` and focus on the **upper 12%** of the frame (`object-position: center 12%`), which ensures faces and heads are centered and visible.
- If a particular photo needs special framing, simply add one of these helper classes to the `<img>`:
  - `focus-top` — Focuses on the very top of the photo.
  - `focus-center` — Focuses on the exact center of the photo.
  - `focus-bottom` — Focuses on the lower area.
  - `fit-contain` — Shrinks photo to fit inside with dark background (great for certificates or wide badges).

---

## 4. Automatic Smart Fallback (No Broken Images)

If you type a wrong filename or haven't added the photo yet:
- The website will **never break or collapse** the card.
- It automatically displays a branded **Phoenix Avatar card** with the person's initials, their full name, and a note saying *"Photo updating soon"*.
- In your browser console (`F12`), a friendly warning will tell you exactly which file was missing.

---

## 5. Copy-Paste Code Templates

### A. Adding a New Core Council Card (`core-team.html`)
```html
<article class="team-card reveal">
  <div class="member-photo">
    <img src="images/team/your-photo.jpg" alt="Full Name - Role" class="lightbox-trigger" />
    <span class="card-role-chip">Executive Council</span>
  </div>
  <div class="member-copy">
    <span class="role-badge">Leadership</span>
    <h3>Full Name</h3>
    <p class="member-title">Your Role / Designation</p>
    <p>A short 1-2 sentence description of their responsibilities and contributions.</p>
    <div class="member-links">
      <a href="mailto:student@nuv.ac.in" aria-label="Email">Email</a>
      <a href="https://linkedin.com" target="_blank" rel="noopener" aria-label="LinkedIn">LinkedIn</a>
    </div>
  </div>
</article>
```

### B. Adding a New Committee Card (`committee.html`)
```html
<article class="team-card small-card">
  <div class="member-photo">
    <img src="images/team/your-photo.jpg" alt="Full Name - Coordinator" class="lightbox-trigger" />
  </div>
  <div class="member-copy">
    <span class="role-badge">Outreach</span>
    <h4>Full Name</h4>
    <p>Department &amp; Coordination Responsibilities</p>
  </div>
</article>
```

---

## 6. Complete Inventory of Image Files

### Core Council & Committee Members (`images/team/`)
- `president-tannushree-shah.png` — Tannushree Shah (President)
- `vice-president-drashti-gosai.jpg` — Drashti Gosai (Vice President)
- `secretary-dwija-patel.jpg` — Dwija Patel (Secretary)
- `treasurer-yash-patel.jpg` — Yash Patel (Treasurer)
- `technical-head-ravichandra-kumar.jpg` — Ravichandra Kumar (Technical Head)
- `media-head-hiral-lokwani.jpg` — Hiral Lokwani (Media Head)
- `outreach-palak-gill.jpg` — Palak Gill (Outreach Coordinator)
- `outreach-afiya-gohel.jpg` — Afiya Gohel (Outreach Coordinator)
- `decoration-radhika-bhalala.jpg` — Radhika Bhalala (Decoration Lead)
- `decoration-chandravali-bhalala.jpg` — Chandravali Bhalala (Decoration Coordinator)
- `decoration-krishna-makwana.jpg` — Krishna Makwana (Decoration Coordinator)
- `decoration-vani-patel.jpg` — Vani Patel (Decoration Coordinator)
- `technical-aditya-nath.jpg` — Aditya Nath (Technical & UI Support)
- `technical-shreya-chauhan.jpg` — Shreya Chauhan (Technical Operations)
- `media-drashti-patel.jpg` — Drashti Patel (Content & Media Lead)
- `media-khadija-daudi.jpg` — Khadija Daudi (Graphic Designer)
- `media-pushti-parekh.jpg` — Pushti Parekh (Social Media Lead)
- `media-vidhi-desai.jpg` — Vidhi Desai (Digital Media Coordinator)

### Events & Campus Galleries (`images/events/`)
- `investiture-ceremony.jpg` — Investiture Ceremony 2026
- `wildlife-week.jpg` — Wildlife Week Celebration
- `teachers-day.jpg` — Teacher's Day Celebration
- `guest-lecture.png` — Distinguished Guest Lecture
- `campus-group.jpg` — Phoenix Club Student Leadership Group
- `community-mixer.jpg` — Student Community Mixer & Orientation
- `science-workshop.jpg` — Science & Innovation Hands-On Workshop
- `annual-gathering.jpg` — Annual Club Gathering & Meet
- `students-collaborating.jpg` — Students Collaborating in Labs
- `interdisciplinary-science.jpg` — Interdisciplinary Science Exhibition
- `awards-ceremony.jpg` — Celebration & Awards Ceremony
