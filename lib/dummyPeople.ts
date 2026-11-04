// Sample people for the rough Meeting / MoM tabs — shared so both screens
// offer the same invitee/attendee list. Dummy data, not real accounts or
// contacts; replace with a real team/contacts fetch once those tabs go live.
export interface Person {
  id: string;
  name: string;
  role: string;
}

export const PEOPLE: Person[] = [
  { id: 'p1', name: 'Chandraprakash', role: 'Admin — PMC' },
  { id: 'p2', name: 'Project Manager', role: 'PMC' },
  { id: 'p3', name: 'Site Engineer', role: 'PMC — Site' },
  { id: 'p4', name: 'Ar. Kavya Sharma', role: 'Architect' },
  { id: 'p5', name: 'Rajesh Gupta', role: 'Client' },
  { id: 'p6', name: 'Suresh Reddy', role: 'Main Contractor' },
  { id: 'p7', name: 'Anil Kumar', role: 'Electrical Vendor' },
  { id: 'p8', name: 'Dr. Srinivas Rao', role: 'Structural Consultant' },
  { id: 'p9', name: 'Anitha Krishnan', role: 'MEP Consultant' },
];

export const personName = (id: string | null) => PEOPLE.find((p) => p.id === id)?.name ?? '—';
export const personInitial = (p: Person) => p.name.replace(/^(Ar\.|Dr\.)\s*/, '').charAt(0);
