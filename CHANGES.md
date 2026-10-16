# fix-1016h-demo (2 files)

Home page demo ("Watch one upload become three posts") now always uses the dark look, in light mode too.
In light mode it sits on a dark rounded stage; dark mode is unchanged.

- components/marketing/DemoFlow.tsx: wrapper gets `dark demo-stage`.
- app/globals.css: `.demo-stage` stage styles; light-only overrides for `.bx-gc` / `.la-themed` skip anything inside a `.dark` wrapper.

Upload both files to the same paths in the repo, then redeploy. If the old look still shows, hard refresh (Ctrl+Shift+R).
