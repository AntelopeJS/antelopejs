## 1. Launch 1 stopping on Ctrl+C: no reload, a generation outside the project runs

Rule broken: Every module generation that is constructed or running is one the project still holds in a ModuleManager: no generation runs on where no stop or destroy can reach it.
Why: a module constructed after the shutdown had already destroyed and dropped it.
In the model, 2 different steps lead into this bug: "a module constructs" and "the shutdown drops every module". The steps below are the shortest path that TLC found.

0. Start: Launch 1 starting: no reload
   (1 hidden step: the launch reads antelope.config.ts)
1. The launch adds modules. Now: Launch 1 starting: no reload
   (1 hidden step: the launch constructs modules)
2. You press Ctrl+C. Now: Launch 1 stopping on Ctrl+C: no reload
   (3 hidden steps: the shutdown stops a module, every module is stopped, the shutdown destroys a module)
3. A module constructs. Now: Launch 1 stopping on Ctrl+C: no reload
4. The shutdown drops every module. Now: Launch 1 stopping on Ctrl+C: no reload, a generation outside the project runs

## 2. Process crashed: no reload

Rule broken: Work a destroyed generation leaves behind never stops the dev process unless the user stopped it.
In the model, one step leads into this bug: "a destroyed generation's leftover work fails". The steps below are the shortest path that TLC found.

0. Start: Launch 1 starting: no reload
   (10 hidden steps: the launch reads antelope.config.ts, the launch adds modules, the launch constructs modules, a module constructs, construction is done, the launch starts modules, a module starts, modules have started, the launch scans module files, the watcher hashes the config)
1. The watcher starts. Now: Launch 1 running: no reload
2. Antelope.config.ts is edited. Now: Launch 1 running: no reload
   (1 hidden step: the watcher hashes the config)
3. Dev restarts for the edit. Now: Launch 1 stopping for a config edit: no reload
   (7 hidden steps: the shutdown stops a module, every module is stopped, the shutdown destroys a module, the shutdown drops every module, the watcher stops, the shutdown releases signals, the shutdown withdraws reload tolerance)
4. A destroyed generation's leftover work fails. Now: Process crashed: no reload

## 3. Launch 2 starting: no reload

Rule broken: Every launch, the ones a config edit restarts included, loads antelope.config.ts as the file holds it when the launch reads it.
Why: a restart began a launch while Ctrl+C was stopping the project, and it read the cached config.
In the model, one step leads into this bug: "the launch reads antelope.config.ts". The steps below are the shortest path that TLC found.

0. Start: Launch 1 starting: no reload
   (9 hidden steps: the launch reads antelope.config.ts, the launch adds modules, the launch constructs modules, a module constructs, construction is done, the launch starts modules, a module starts, modules have started, the launch scans module files)
1. You press Ctrl+C. Now: Launch 1 stopping on Ctrl+C: no reload
   (2 hidden steps: the watcher hashes the config, the watcher starts)
2. Antelope.config.ts is edited. Now: Launch 1 stopping on Ctrl+C: no reload
   (8 hidden steps: the shutdown stops a module, every module is stopped, the shutdown destroys a module, the shutdown drops every module, the watcher hashes the config, the watcher stops, the shutdown releases signals, dev restarts for the edit)
3. The next launch begins. Now: Launch 2 starting: no reload
4. The launch reads antelope.config.ts. Now: Launch 2 starting: no reload

## 4. Launch 2 starting: no reload

Rule broken: Every launch, the ones a config edit restarts included, loads antelope.config.ts as the file holds it when the launch reads it.
Why: the restart for the edit read the config jiti had cached, not the edited file.
In the model, one step leads into this bug: "the launch reads antelope.config.ts". The steps below are the shortest path that TLC found.

0. Start: Launch 1 starting: no reload
   (10 hidden steps: the launch reads antelope.config.ts, the launch adds modules, the launch constructs modules, a module constructs, construction is done, the launch starts modules, a module starts, modules have started, the launch scans module files, the watcher hashes the config)
1. The watcher starts. Now: Launch 1 running: no reload
2. Antelope.config.ts is edited. Now: Launch 1 running: no reload
   (1 hidden step: the watcher hashes the config)
3. Dev restarts for the edit. Now: Launch 1 stopping for a config edit: no reload
   (7 hidden steps: the shutdown stops a module, every module is stopped, the shutdown destroys a module, the shutdown drops every module, the watcher stops, the shutdown releases signals, the shutdown withdraws reload tolerance)
4. The shutdown ends. Now: Launch 1 stopped: no reload
5. The next launch begins. Now: Launch 2 starting: no reload
6. The launch reads antelope.config.ts. Now: Launch 2 starting: no reload

## 5. Launch 2 stopping after a crash: no reload

Rule broken: Work a destroyed generation leaves behind never stops the dev process unless the user stopped it.
In the model, one step leads into this bug: "a destroyed generation's leftover work fails". The steps below are the shortest path that TLC found.

0. Start: Launch 1 starting: no reload
   (10 hidden steps: the launch reads antelope.config.ts, the launch adds modules, the launch constructs modules, a module constructs, construction is done, the launch starts modules, a module starts, modules have started, the launch scans module files, the watcher hashes the config)
1. The watcher starts. Now: Launch 1 running: no reload
2. Antelope.config.ts is edited. Now: Launch 1 running: no reload
   (1 hidden step: the watcher hashes the config)
3. Dev restarts for the edit. Now: Launch 1 stopping for a config edit: no reload
   (7 hidden steps: the shutdown stops a module, every module is stopped, the shutdown destroys a module, the shutdown drops every module, the watcher stops, the shutdown releases signals, the shutdown withdraws reload tolerance)
4. The shutdown ends. Now: Launch 1 stopped: no reload
5. The next launch begins. Now: Launch 2 starting: no reload
6. A destroyed generation's leftover work fails. Now: Launch 2 stopping after a crash: no reload

## 6. Launch 1 running: no reload

Rule broken: Once the project settles, it holds exactly the modules antelope.config.ts declares: adding or removing a module while dev runs reaches the project.
Why: the edit landed after the launch read the config and before the watcher started.
In the model, one step leads into this bug: "the watcher starts". The steps below are the shortest path that TLC found.

0. Start: Launch 1 starting: no reload
1. The launch reads antelope.config.ts. Now: Launch 1 starting: no reload
2. Antelope.config.ts is edited. Now: Launch 1 starting: no reload
3. The launch adds modules. Now: Launch 1 starting: no reload
4. The launch constructs modules. Now: Launch 1 starting: no reload
   (1 hidden step: a module constructs)
5. Construction is done. Now: Launch 1 starting: no reload
6. The launch starts modules. Now: Launch 1 starting: no reload
   (1 hidden step: a module starts)
7. Modules have started. Now: Launch 1 starting: no reload
8. The launch scans module files. Now: Launch 1 starting: no reload
9. The watcher hashes the config. Now: Launch 1 starting: no reload
10. The watcher starts. Now: Launch 1 running: no reload

## 7. Launch 2 running: no reload

Rule broken: Once the project settles, it holds exactly the modules antelope.config.ts declares: adding or removing a module while dev runs reaches the project.
Why: the restart re-read the config jiti had cached, not the edited file.
In the model, one step leads into this bug: "the watcher starts". The steps below are the shortest path that TLC found.

0. Start: Launch 1 starting: no reload
1. The launch reads antelope.config.ts. Now: Launch 1 starting: no reload
2. The launch adds modules. Now: Launch 1 starting: no reload
3. The launch constructs modules. Now: Launch 1 starting: no reload
   (1 hidden step: a module constructs)
4. Construction is done. Now: Launch 1 starting: no reload
5. The launch starts modules. Now: Launch 1 starting: no reload
   (1 hidden step: a module starts)
6. Modules have started. Now: Launch 1 starting: no reload
7. The launch scans module files. Now: Launch 1 starting: no reload
8. You press Ctrl+C. Now: Launch 1 stopping on Ctrl+C: no reload
9. The watcher hashes the config. Now: Launch 1 stopping on Ctrl+C: no reload
10. The watcher starts. Now: Launch 1 stopping on Ctrl+C: no reload
11. Antelope.config.ts is edited. Now: Launch 1 stopping on Ctrl+C: no reload
   (1 hidden step: the shutdown stops a module)
12. Every module is stopped. Now: Launch 1 stopping on Ctrl+C: no reload
   (1 hidden step: the shutdown destroys a module)
13. The shutdown drops every module. Now: Launch 1 stopping on Ctrl+C: no reload
14. The watcher hashes the config. Now: Launch 1 stopping on Ctrl+C: no reload
15. The watcher stops. Now: Launch 1 stopping on Ctrl+C: no reload
16. The shutdown releases signals. Now: Launch 1 stopping on Ctrl+C: no reload
17. Dev restarts for the edit. Now: Launch 1 stopping on Ctrl+C: no reload
18. The next launch begins. Now: Launch 2 starting: no reload
19. The launch reads antelope.config.ts. Now: Launch 2 starting: no reload
20. The launch adds modules. Now: Launch 2 starting: no reload
21. The launch constructs modules. Now: Launch 2 starting: no reload
   (1 hidden step: a module constructs)
22. Construction is done. Now: Launch 2 starting: no reload
23. The launch starts modules. Now: Launch 2 starting: no reload
   (1 hidden step: a module starts)
24. Modules have started. Now: Launch 2 starting: no reload
25. The launch scans module files. Now: Launch 2 starting: no reload
26. The watcher hashes the config. Now: Launch 2 starting: no reload
27. The watcher starts. Now: Launch 2 running: no reload
