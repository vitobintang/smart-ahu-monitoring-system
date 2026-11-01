\# Smart AHU Monitoring System



\## Project goal



Build a web application for monitoring seven Air Handling Units

and managing their operational information.



\## Main features



\- A dashboard showing all seven AHUs.

\- Individual AHU pages with sensor readings and charts.

\- Historical data, reports, CSV export, and print/PDF.

\- Threshold, fault, and communication alarms.

\- Trend estimates and in-app notifications.

\- Four roles: Admin, Engineering, Operator, and Viewer.

\- Login plus Admin-authorized access for each user's browser/device.

\- Separate credentials for devices that send AHU telemetry.

\- A built-in simulator with clearly labeled simulated data.

\- Configuration and audit logs.

\- Simulated command workflows for START, STOP, mode, and setpoint.



\## Technology direction



\- Next.js, React, and TypeScript.

\- Supabase for the database and authentication.

\- Server-side permission checks.

\- Browser updates through application API polling.



\## Safety boundaries



\- Physical control is not enabled until a real integration has

&#x20; been independently reviewed, tested, and commissioned.

\- The web STOP button is not an emergency stop.

\- Simulated readings must not be presented as physical readings.

\- The system must not claim to provide an independent offline

&#x20; fallback unless one is actually built and tested.



\## Requirements



The AHU requirements document and the project decisions above

are the starting point. Each requirement must be checked and

tested during development.

