To load the PoPs demo data just run the "load.js" script using NodeJS.

"export.js" is to extract a set of Capacity Plan data which has already been done in this case.

This will assume that the new environment has 4 levels of portfolio item types.

## What It Does ##

### node load.js ###

When you run this command you will be prompted for a few key bits of information necessary to create the dataset.  Those items are:

* Rally URL - this will default to "https://rally1.rallydev.com" if you just hit ENTER
* Rally API key - You can generate one of these in the "My Settings" portion of the application.
* Workspace ID - This is the Object ID for your workspace.  It is the ID type without letters and dashes in it
* Project ID - The ID for the *parent* project for all of the projects, items, and releases that will be generated.  It is best if this is a "leaf" node in your project hierarchy.  (You can find this ID in the URL, just remember to remove the "d" from the end for it to work)

At this point, it will begin its creation routine and you will end up with...

A project hierarchy underneath the project you specified that looks like this:
<img width="464" alt="image" src="https://github.com/natebever-rally/pops-re-creator/assets/83733997/774e3121-935b-4f5e-8a3f-4a461d47e6e3">

In addition, you should see...

* 100 releases created with names like "2024 Q1".  This equates to 4 releases created per new project.
* Tons of portfolio items
  ..* There are 4 sets of items suffixed by [_n_] where _n_ is 1-4 and expresses the phase of planning it relates to.  Think of these as a progression through time and planning fidelity so plans can be modeled in a way that you can see a yearly progression from inception to several quarters in.
  ..* It creates a deep hierarchy of related items with Strategies, Initiatives, Capabilities, Features, and Stories.
  ..* At various points in the progression estimates are also added and refined.

  <img width="622" alt="image" src="https://github.com/natebever-rally/pops-re-creator/assets/83733997/79bd292d-08c0-44d1-b055-2704f0e403eb">

* Approx. 33 Capacity Plans
  ..* These are also suffixed with [_n_] where _n_ is again the phase of planning they represent.  In this fashion "2" is an initial yearly plan and it gets more refined and realistic as you progress.
  ..* Many of these plans have been connected in a Rollup or Mirror way to show a realistic picture of what "Plan of Plans" looks like as you progress.

## How Does It Work ##

In the simplest of terms, the "export.js" script has already been run against the original set of Plan of Plans demo data and it dumped all of the full objects into the folders you see that end with "pops".  The "load.js" script reads those files and systematically re-creates them where you have indicated you'd like them to live.  It also works to reconcile differences between Preliminary Estimates in the two systems, PI types, and keeps track of the relationship between the exported IDs and the new IDs the items get in your system.  By doing these things it does not require much of the new system except that it has at least 4 PI types available.  (This is because the source data had 4 and it does not adapt it self to ignoring any of the exported levels)


