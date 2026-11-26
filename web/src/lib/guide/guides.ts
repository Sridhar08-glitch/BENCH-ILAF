// The getting-started guides, one per audience. To add or change a step, edit the data here and add its two texts
// (title and text) in lib/i18n/en/guide.ts and ar/guide.ts. The engine and the checklist need no change.
import { tk } from "@/lib/i18n";
import type { Audience, Guide, Step } from "./types";

const at = (name: string) => `[data-guide="${name}"]`;

const profile: Step = {
  id: "profile",
  title: tk("guide.step.profile.title"),
  text: tk("guide.step.profile.text"),
  route: "/app/cards/{card}",
  doneWhen: { all: [{ is: "has_name" }, { is: "has_photo" }] },
  focus: { target: at("editor-body"), openFirst: at("editor-tab-profile") },
};
const buttons: Step = {
  id: "buttons",
  title: tk("guide.step.buttons.title"),
  text: tk("guide.step.buttons.text"),
  route: "/app/cards/{card}",
  doneWhen: { gte: ["items_count", 2] },
  focus: { target: at("editor-body"), openFirst: at("editor-tab-buttons") },
};
const design: Step = {
  id: "design",
  title: tk("guide.step.design.title"),
  text: tk("guide.step.design.text"),
  route: "/app/cards/{card}",
  doneWhen: { is: "design_changed" },
  focus: { target: at("editor-body"), openFirst: at("editor-tab-look") },
};
const publish: Step = {
  id: "publish",
  title: tk("guide.step.publish.title"),
  text: tk("guide.step.publish.text"),
  route: "/app/cards/{card}",
  doneWhen: { is: "card_published" },
  focus: { target: at("editor-publish") },
};
const share: Step = {
  id: "share",
  title: tk("guide.step.share.title"),
  text: tk("guide.step.share.text"),
  route: "/app/share",
  doneWhen: { is: "shared_qr_opened" },
  focus: { target: at("qr-main") },
};

const ownerSteps: Step[] = [
  {
    id: "brand",
    title: tk("guide.step.brand.title"),
    text: tk("guide.step.brand.text"),
    route: "/app/brand",
    doneWhen: { all: [{ is: "brand_logo_set" }, { is: "brand_colours_set" }] },
  focus: { target: at("brand-steps") },
  },
  {
    id: "card-style",
    title: tk("guide.step.cardStyle.title"),
    text: tk("guide.step.cardStyle.text"),
    route: "/app/brand",
    doneWhen: { is: "brand_style_set" },
  focus: { target: at("brand-steps") },
  },
  {
    id: "lock",
    title: tk("guide.step.lock.title"),
    text: tk("guide.step.lock.text"),
    route: "/app/brand",
    doneWhen: { is: "lock_enabled" },
  focus: { target: at("brand-steps") },
  },
  {
    id: "invite",
    title: tk("guide.step.invite.title"),
    text: tk("guide.step.invite.text"),
    route: "/app/team",
    doneWhen: { gte: ["invites_sent", 1] },
  focus: { target: at("team-invite") },
  },
  {
    id: "departments",
    title: tk("guide.step.departments.title"),
    text: tk("guide.step.departments.text"),
    route: "/app/departments",
    doneWhen: { gte: ["departments_count", 1] },
  focus: { target: at("departments-main") },
  },
  {
    id: "publish-cards",
    title: tk("guide.step.publishCards.title"),
    text: tk("guide.step.publishCards.text"),
    route: "/app/cards",
    doneWhen: { gte: ["published_count", 1] },
  focus: { target: at("cards-actions") },
  },
];
const directory: Step = {
  id: "directory",
  title: tk("guide.step.directory.title"),
  text: tk("guide.step.directory.text"),
  route: "/app/directory",
  doneWhen: { is: "directory_enabled" },
  focus: { target: at("directory-main") },
  optional: true,
};

export const GUIDES: Record<Audience, Guide> = {
  personal: {
    id: "personal",
    title: tk("guide.personal.title"),
    intro: tk("guide.personal.intro"),
    steps: [profile, buttons, design, publish, share],
  },
  company_owner: {
    id: "company_owner",
    title: tk("guide.owner.title"),
    intro: tk("guide.owner.intro"),
    steps: [...ownerSteps, directory],
  },
  // Admins manage the team and the cards; only the owner switches the public directory on.
  company_admin: {
    id: "company_admin",
    title: tk("guide.admin.title"),
    intro: tk("guide.admin.intro"),
    steps: ownerSteps,
  },
  employee: {
    id: "employee",
    title: tk("guide.employee.title"),
    intro: tk("guide.employee.intro"),
    steps: [
      {
        id: "accept-invite",
        title: tk("guide.step.acceptInvite.title"),
        text: tk("guide.step.acceptInvite.text"),
        route: "/app/cards",
        doneWhen: { is: "invite_accepted" },
      },
      {
        id: "fill-details",
        title: tk("guide.step.fillDetails.title"),
        text: tk("guide.step.fillDetails.text"),
        route: "/app/cards/{card}",
        doneWhen: { all: [{ is: "has_title" }, { is: "has_photo" }, { gte: ["items_count", 1] }] },
  focus: { target: at("editor-body"), openFirst: at("editor-tab-profile") },
      },
      {
        id: "send-approval",
        title: tk("guide.step.sendApproval.title"),
        text: tk("guide.step.sendApproval.text"),
        route: "/app/cards/{card}",
        doneWhen: { is: "approval_sent" },
  focus: { target: at("editor-publish") },
        appliesWhen: { is: "approval_rules" },
      },
      publish,
      share,
    ],
  },
};

export function guideFor(audience: Audience): Guide {
  return GUIDES[audience];
}
