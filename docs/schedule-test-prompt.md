# Schedule mechanism test job

A minimal job with no purpose beyond proving the schedule mechanism works
end to end: it fires, runs, and its output shows up on `/schedule`.

Write the current UTC date and time to a file named `heartbeat.txt` inside
`$AIDE_SCHEDULE_OUTPUT_DIR` (create the directory if it does not already
exist). One line, plain text, nothing else in the file.

Do not read, write, or touch anything else in this repository. Do not
commit or push anything — this job's checkout is read-only.
