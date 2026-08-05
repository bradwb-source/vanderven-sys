const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  VerticalAlign,
  ShadingType,
  Header,
  Footer,
  PageNumber,
  ImageRun,
  convertInchesToTwip,
} = require("docx");
const fs = require("fs");
const path = require("path");

const C = {
  deep: "143D32",
  sage: "2F6F5E",
  mist: "E7F1EC",
  sand: "F3EEE4",
  ink: "24302C",
  mute: "5C6862",
  line: "C2D2C9",
  white: "FFFFFF",
  gold: "B8894A",
};

const PAGE_W = 12240;
const MARGIN = 540;
const CONTENT_W = PAGE_W - MARGIN * 2;
const IMG = path.join(__dirname, "images");

const noBorder = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

const softBorder = {
  top: { style: BorderStyle.SINGLE, size: 6, color: C.line },
  bottom: { style: BorderStyle.SINGLE, size: 6, color: C.line },
  left: { style: BorderStyle.SINGLE, size: 6, color: C.line },
  right: { style: BorderStyle.SINGLE, size: 6, color: C.line },
};

const leftAccent = {
  top: { style: BorderStyle.SINGLE, size: 6, color: C.line },
  bottom: { style: BorderStyle.SINGLE, size: 6, color: C.line },
  left: { style: BorderStyle.SINGLE, size: 40, color: C.gold },
  right: { style: BorderStyle.SINGLE, size: 6, color: C.line },
};

function cell(children, opts = {}) {
  return new TableCell({
    borders: opts.borders || noBorder,
    width: { size: opts.width || CONTENT_W, type: WidthType.DXA },
    shading: opts.fill
      ? { type: ShadingType.CLEAR, fill: opts.fill }
      : undefined,
    verticalAlign: opts.vAlign || VerticalAlign.TOP,
    margins: {
      top: opts.padT ?? 100,
      bottom: opts.padB ?? 100,
      left: opts.padL ?? 140,
      right: opts.padR ?? 140,
    },
    children: Array.isArray(children) ? children : [children],
  });
}

function img(file, w, h, name) {
  return new ImageRun({
    type: path.extname(file).slice(1) === "png" ? "png" : "jpg",
    data: fs.readFileSync(file),
    transformation: { width: w, height: h },
    altText: { title: name, description: name, name },
  });
}

function spacer(after = 80) {
  return new Paragraph({ spacing: { before: 0, after }, children: [] });
}

function label(text) {
  return new Paragraph({
    spacing: { before: 240, after: 70 },
    children: [
      new TextRun({
        text: text.toUpperCase(),
        font: "Calibri",
        size: 17,
        bold: true,
        color: C.sage,
        characterSpacing: 90,
      }),
    ],
  });
}

function body(text, opts = {}) {
  return new Paragraph({
    spacing: { before: opts.before ?? 0, after: opts.after ?? 90 },
    children: [
      new TextRun({
        text,
        font: "Calibri",
        size: opts.size ?? 20,
        color: opts.color ?? C.ink,
        italics: opts.italics,
        bold: opts.bold,
      }),
    ],
  });
}

function ph(text) {
  return body(text, { color: C.mute, italics: true, size: 19, after: 80 });
}

function bullet(text, sample = false) {
  return new Paragraph({
    spacing: { before: 30, after: 40 },
    indent: { left: convertInchesToTwip(0.12) },
    children: [
      new TextRun({ text: "◆  ", font: "Calibri", size: 16, color: C.gold }),
      new TextRun({
        text,
        font: "Calibri",
        size: 19,
        color: sample ? C.mute : C.ink,
        italics: sample,
      }),
    ],
  });
}

const heroPath = path.join(IMG, "hero.jpg");
const orchardPath = path.join(IMG, "orchard.jpg");
const shorePath = path.join(IMG, "shore.jpg");
const lakePath = path.join(IMG, "lake-stock.jpg");

const HERO_W = 700;
const HERO_H = 250;
const ORCHARD_W = 320;
const ORCHARD_H = 210;
const SHORE_W = 210;
const SHORE_H = 280;
const STRIP_W = 700;
const STRIP_H = 78;

const colL = Math.floor(CONTENT_W * 0.58);
const colR = CONTENT_W - colL;

const OUT = path.join(
  __dirname,
  "Rutland-Community-Clinic-Staff-Newsletter-Template.docx"
);

const doc = new Document({
  sections: [
    {
      properties: {
        page: {
          size: { width: PAGE_W, height: 15840 },
          margin: {
            top: MARGIN,
            bottom: MARGIN,
            left: MARGIN,
            right: MARGIN,
          },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({
                  text: "Internal use only  ·  Rutland Community Clinic team",
                  font: "Calibri",
                  size: 14,
                  color: C.mute,
                  italics: true,
                }),
              ],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              border: {
                top: {
                  style: BorderStyle.SINGLE,
                  size: 6,
                  color: C.line,
                  space: 6,
                },
              },
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: "RCC Staff Newsletter  ·  #105 – 330 Hwy 33 W, Kelowna  ·  Page ",
                  font: "Calibri",
                  size: 14,
                  color: C.mute,
                }),
                new TextRun({
                  children: [PageNumber.CURRENT],
                  font: "Calibri",
                  size: 14,
                  color: C.mute,
                }),
              ],
            }),
          ],
        }),
      },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 0 },
          children: [
            img(heroPath, HERO_W, HERO_H, "Okanagan Lake at golden hour"),
          ],
        }),

        new Table({
          width: { size: CONTENT_W, type: WidthType.DXA },
          columnWidths: [CONTENT_W],
          rows: [
            new TableRow({
              children: [
                cell(
                  [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      spacing: { before: 40, after: 20 },
                      children: [
                        new TextRun({
                          text: "RUTLAND COMMUNITY CLINIC",
                          font: "Georgia",
                          size: 36,
                          bold: true,
                          color: C.white,
                          characterSpacing: 80,
                        }),
                      ],
                    }),
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      spacing: { after: 40 },
                      children: [
                        new TextRun({
                          text: "Staff Newsletter  ·  Team-based primary care, Rutland",
                          font: "Calibri",
                          size: 17,
                          color: "D5E8DE",
                        }),
                      ],
                    }),
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      border: {
                        top: {
                          style: BorderStyle.SINGLE,
                          size: 4,
                          color: "3D7A68",
                          space: 1,
                        },
                      },
                      spacing: { before: 40, after: 20 },
                      children: [
                        new TextRun({
                          text: "FOR THE CARE TEAM — NOT FOR PATIENTS",
                          font: "Calibri",
                          size: 15,
                          bold: true,
                          color: "C4A46A",
                          characterSpacing: 100,
                        }),
                      ],
                    }),
                  ],
                  {
                    fill: C.deep,
                    padT: 160,
                    padB: 140,
                    padL: 200,
                    padR: 200,
                    width: CONTENT_W,
                  }
                ),
              ],
            }),
          ],
        }),

        new Table({
          width: { size: CONTENT_W, type: WidthType.DXA },
          columnWidths: [
            Math.floor(CONTENT_W * 0.62),
            Math.floor(CONTENT_W * 0.38),
          ],
          rows: [
            new TableRow({
              children: [
                cell(
                  [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: "Issue  ",
                          font: "Calibri",
                          size: 17,
                          color: C.mute,
                        }),
                        new TextRun({
                          text: "[Month Year]",
                          font: "Georgia",
                          size: 20,
                          italics: true,
                          bold: true,
                          color: C.deep,
                        }),
                      ],
                    }),
                  ],
                  {
                    fill: C.mist,
                    padT: 90,
                    padB: 90,
                    padL: 180,
                    width: Math.floor(CONTENT_W * 0.62),
                  }
                ),
                cell(
                  [
                    new Paragraph({
                      alignment: AlignmentType.RIGHT,
                      children: [
                        new TextRun({
                          text: "Vol. ",
                          font: "Calibri",
                          size: 17,
                          color: C.mute,
                        }),
                        new TextRun({
                          text: "[YY]-[MM]",
                          font: "Georgia",
                          size: 20,
                          italics: true,
                          bold: true,
                          color: C.deep,
                        }),
                      ],
                    }),
                  ],
                  {
                    fill: C.mist,
                    padT: 90,
                    padB: 90,
                    padR: 180,
                    width: Math.floor(CONTENT_W * 0.38),
                  }
                ),
              ],
            }),
          ],
        }),

        spacer(60),

        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
          children: [img(lakePath, STRIP_W, STRIP_H, "Okanagan waters")],
        }),

        label("From clinic leadership"),
        new Table({
          width: { size: CONTENT_W, type: WidthType.DXA },
          columnWidths: [CONTENT_W - 2800, 2800],
          rows: [
            new TableRow({
              children: [
                cell(
                  [
                    body(
                      "Hi team — this monthly note is for RCC staff: coverage, ops, and anything that helps our team-based days run smoother. Skim before huddle; print one for the front desk if helpful."
                    ),
                    ph(
                      "[2–4 sentences from Dr. van Zyl / Teresa / Renée: priorities this month, thanks, or a heads-up.]"
                    ),
                    body(
                      "Vision reminder: Creating systemic change in healthcare through collaboration.",
                      { size: 17, color: C.sage, italics: true, after: 40 }
                    ),
                  ],
                  {
                    width: CONTENT_W - 2800,
                    padR: 200,
                    vAlign: VerticalAlign.CENTER,
                  }
                ),
                cell(
                  [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        img(shorePath, SHORE_W, SHORE_H, "Okanagan shoreline"),
                      ],
                    }),
                  ],
                  {
                    width: 2800,
                    fill: C.sand,
                    borders: softBorder,
                    padT: 80,
                    padB: 80,
                    padL: 80,
                    padR: 80,
                  }
                ),
              ],
            }),
          ],
        }),

        label("Staffing & coverage"),
        new Table({
          width: { size: CONTENT_W, type: WidthType.DXA },
          columnWidths: [CONTENT_W],
          rows: [
            new TableRow({
              children: [
                cell(
                  [
                    body(
                      "Who’s in, who’s away, and who covers — so booking, triage, and the calendar stay accurate.",
                      {
                        italics: true,
                        color: C.mute,
                        size: 18,
                        after: 60,
                      }
                    ),
                    bullet(
                      "[Name] — [role] starts / returns [date]; access & orientation checklist done?",
                      true
                    ),
                    bullet(
                      "[Name] — away [dates]; coverage: [clinician / MOA]; flag in schedule & calendar.",
                      true
                    ),
                    bullet(
                      "[Name] — Youth MH / women’s health / kinesiology schedule notes for front desk.",
                      true
                    ),
                    spacer(40),
                    new Paragraph({
                      spacing: { after: 40 },
                      children: [
                        new TextRun({
                          text: "Clinic team (update if roles change)",
                          font: "Georgia",
                          size: 18,
                          bold: true,
                          color: C.deep,
                        }),
                      ],
                    }),
                    body(
                      "Medical director: Dr. Marile van Zyl  ·  Family physician / youth mental health: Dr. Elliot Frank",
                      { size: 17, color: C.mute, after: 30 }
                    ),
                    body(
                      "Clinic manager: Teresa  ·  MOAs: Doris · Kamal  ·  Kinesiologist: Kiarra",
                      { size: 17, color: C.mute, after: 30 }
                    ),
                    body(
                      "Executive director: Renée Gauthier  ·  Board: see Our Team page if governance items arise",
                      { size: 17, color: C.mute, after: 20 }
                    ),
                  ],
                  {
                    borders: leftAccent,
                    fill: C.white,
                    padT: 140,
                    padB: 140,
                    padL: 200,
                    padR: 180,
                    width: CONTENT_W,
                  }
                ),
              ],
            }),
          ],
        }),

        label("Ops & clinic news"),
        body(
          "Process changes, hours, calendar events, and anything that affects phones, booking, or the floor."
        ),
        bullet(
          "[Change] — what changed, effective date, and who owns it.",
          true
        ),
        bullet(
          "[Holiday / early close] — phone message, online booking rules, urgent path (UPCC / ED).",
          true
        ),
        bullet(
          "[Calendar] — e.g. Youth Mental Health Appointments days; who books / who covers.",
          true
        ),
        bullet(
          "[Forms / EMR / billing tip] — short note so everyone does it the same way.",
          true
        ),

        label("Focus this month"),
        new Table({
          width: { size: CONTENT_W, type: WidthType.DXA },
          columnWidths: [colL, colR],
          rows: [
            new TableRow({
              children: [
                cell(
                  [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      spacing: { after: 80 },
                      children: [
                        img(
                          orchardPath,
                          ORCHARD_W,
                          ORCHARD_H,
                          "Okanagan vineyard & orchard"
                        ),
                      ],
                    }),
                    new Paragraph({
                      spacing: { after: 70 },
                      children: [
                        new TextRun({
                          text: "[Theme — e.g. eligibility & warm referrals]",
                          font: "Georgia",
                          size: 22,
                          bold: true,
                          italics: true,
                          color: C.deep,
                        }),
                      ],
                    }),
                    ph(
                      "[What we want the whole team practising this month: a workflow, safety check, documentation habit, or patient-comms standard. Keep it concrete — 3–5 sentences + who to ask.]"
                    ),
                  ],
                  {
                    borders: softBorder,
                    fill: C.mist,
                    padT: 140,
                    padB: 140,
                    padL: 160,
                    padR: 160,
                    width: colL,
                  }
                ),
                cell(
                  [
                    new Paragraph({
                      spacing: { after: 80 },
                      children: [
                        new TextRun({
                          text: "QUICK HITS FOR STAFF",
                          font: "Calibri",
                          size: 16,
                          bold: true,
                          color: C.gold,
                          characterSpacing: 70,
                        }),
                      ],
                    }),
                    bullet(
                      "Online booking = existing patients only; new patients call / walk in."
                    ),
                    bullet(
                      "Eligibility: Indigenous, newcomer to Canada, or women’s health needs."
                    ),
                    bullet(
                      "If not a fit — warm-hand to UPCC, Medi-Map, Health Connect Registry, 8-1-1."
                    ),
                    bullet(
                      "Offer translation services when language is a barrier."
                    ),
                    bullet(
                      "Document coverage on the schedule — not only verbally."
                    ),
                    spacer(60),
                    new Paragraph({
                      spacing: { after: 40 },
                      children: [
                        new TextRun({
                          text: "Services snapshot",
                          font: "Georgia",
                          size: 16,
                          bold: true,
                          color: C.deep,
                        }),
                      ],
                    }),
                    body(
                      "Family & women’s health · Rx · Labs/diagnostics · Exercise therapy · MH & sexual health (coming soon)",
                      { size: 15, color: C.mute, after: 40 }
                    ),
                  ],
                  {
                    borders: softBorder,
                    fill: C.sand,
                    padT: 160,
                    padB: 160,
                    padL: 180,
                    padR: 160,
                    width: colR,
                    vAlign: VerticalAlign.TOP,
                  }
                ),
              ],
            }),
          ],
        }),

        label("Meetings, training & shout-outs"),
        bullet(
          "[Meeting] — date/time, who should attend, prep if any.",
          true
        ),
        bullet(
          "[Training / in-clinic education] — link, binder, or who is leading.",
          true
        ),
        bullet(
          "[Shout-out] — name + what they did that helped the team.",
          true
        ),

        label("Action items"),
        new Table({
          width: { size: CONTENT_W, type: WidthType.DXA },
          columnWidths: [CONTENT_W],
          rows: [
            new TableRow({
              children: [
                cell(
                  [
                    bullet("[Owner] — [task] — due [date]", true),
                    bullet("[Owner] — [task] — due [date]", true),
                    bullet("[Owner] — [task] — due [date]", true),
                  ],
                  {
                    borders: softBorder,
                    fill: C.mist,
                    padT: 120,
                    padB: 120,
                    padL: 180,
                    padR: 180,
                    width: CONTENT_W,
                  }
                ),
              ],
            }),
          ],
        }),

        spacer(160),

        new Table({
          width: { size: CONTENT_W, type: WidthType.DXA },
          columnWidths: [CONTENT_W],
          rows: [
            new TableRow({
              children: [
                cell(
                  [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      spacing: { after: 60 },
                      children: [
                        new TextRun({
                          text: "CLINIC DESK REFERENCE",
                          font: "Calibri",
                          size: 15,
                          bold: true,
                          color: "C4A46A",
                          characterSpacing: 100,
                        }),
                      ],
                    }),
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      spacing: { after: 30 },
                      children: [
                        new TextRun({
                          text: "#105 – 330 Highway 33 West, Kelowna, BC  V1X 1X9",
                          font: "Georgia",
                          size: 18,
                          color: C.white,
                        }),
                      ],
                    }),
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      spacing: { after: 30 },
                      children: [
                        new TextRun({
                          text: "Phone  (250) 717-8716",
                          font: "Calibri",
                          size: 17,
                          color: C.white,
                        }),
                        new TextRun({
                          text: "   ·   ",
                          font: "Calibri",
                          size: 17,
                          color: "3D7A68",
                        }),
                        new TextRun({
                          text: "Fax  (250) 980-4720",
                          font: "Calibri",
                          size: 17,
                          color: C.white,
                        }),
                      ],
                    }),
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      spacing: { after: 40 },
                      children: [
                        new TextRun({
                          text: "Hours  Monday–Friday, 8:00 am – 4:30 pm",
                          font: "Calibri",
                          size: 16,
                          color: "D5E8DE",
                        }),
                      ],
                    }),
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        new TextRun({
                          text: "rutlandcommunityclinic.ca  ·  Internal only — do not post in waiting room",
                          font: "Calibri",
                          size: 15,
                          color: "C4A46A",
                        }),
                      ],
                    }),
                  ],
                  {
                    fill: C.deep,
                    padT: 180,
                    padB: 160,
                    padL: 200,
                    padR: 200,
                    width: CONTENT_W,
                  }
                ),
              ],
            }),
          ],
        }),

        spacer(100),
        new Paragraph({
          border: {
            top: {
              style: BorderStyle.SINGLE,
              size: 4,
              color: C.line,
              space: 8,
            },
          },
          spacing: { before: 40, after: 40 },
          children: [
            new TextRun({
              text: "MONTHLY EDITING TIP  ",
              font: "Calibri",
              size: 13,
              bold: true,
              color: C.mute,
            }),
            new TextRun({
              text: "Save As → RCC-Staff-Newsletter-YYYY-MM.docx → replace every [bracket] → email the team or print for the staff room. Photos stay; swap text only.",
              font: "Calibri",
              size: 13,
              color: C.mute,
            }),
          ],
        }),
      ],
    },
  ],
});

async function main() {
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(OUT, buffer);
  // Also refresh the old filename so open tabs aren’t confusing
  const legacy = path.join(
    __dirname,
    "CGB-Medical-Monthly-Newsletter-Template.docx"
  );
  fs.writeFileSync(legacy, buffer);
  console.log("Wrote:", OUT);
  console.log("Also updated:", legacy);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
