// One action a person took on a job, as the job keeps it: what was done,
// when, and where the request came from.

export interface JobAction {
  at: string;
  action: string;
  from: string;
}
