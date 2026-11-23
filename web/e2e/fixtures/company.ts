import { PASSWORD, api, dismissWelcome, inviteMember, remember, uniqueEmail, type Json, type TestUser } from "./api";
import { linkTo, waitForMail } from "./mail";

export interface Employee extends TestUser {
  memberId: string;
  cardId: string;
}

/** The token in the invitation link of the mail sent to `email`. */
export async function inviteTokenFor(email: string): Promise<string> {
  const mail = await waitForMail(email, /invit|join/i);
  const link = linkTo(mail, "/join/");
  const token = new URL(link).pathname.split("/").pop();
  if (!token) throw new Error("the invitation mail has no token");
  return decodeURIComponent(token);
}

/** Invites a person and lets them join straight through the API (the browser flow is covered by its own test). */
export async function addEmployee(owner: TestUser, ws: string, opts: { name?: string; email?: string; extra?: Json } = {}): Promise<Employee> {
  const email = opts.email ?? uniqueEmail("emp");
  const name = opts.name ?? "Eve Employee";
  const member = await inviteMember(owner, ws, email, { full_name: name, ...(opts.extra ?? {}) });
  const token = await inviteTokenFor(email);
  const { data } = await api<{ access: string; refresh: string; workspace_id: string }>("POST", "invites/accept", {
    body: { token, password: PASSWORD, full_name: name },
  });
  remember(email);
  const employee = { email, password: PASSWORD, name, access: data.access, refresh: data.refresh, ws: data.workspace_id, memberId: member.id, cardId: member.card_id };
  await dismissWelcome(employee);
  return employee;
}
