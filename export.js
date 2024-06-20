import readline from 'readline-sync';
import fetch from 'node-fetch';
import fs, { write } from 'fs';

const RELEASE_DIR = 'releases';
const PLAN_DIR = 'plans';
const ITEM_DIR = 'items';
const PROJECT_DIR = 'project';
const PI_HIERARCHY = 'old_pi_hierarchy';
const baseRallyURL = 'https://rally1.rallydev.com';
const baseAPIPath = '/slm/webservice/v2.0';
const basePath = `${baseRallyURL}${baseAPIPath}`;

const apiKey = readline.question('APIKey: ');

const projectId = readline.question('Parent project ID: ');
const portfolioType = 0;//readline.question('Portfolio Item Type (Ordinal): ');

console.log('Attempting to connect...');

const writeTheThing = function(dirName, item) {

    fs.writeFile(`${dirName}/${item.ObjectID}`, JSON.stringify(item), (err) => {
        if (err) {
            console.log(`Error writing ${dirName} ${item.ObjectID}: ${err}\n`);
        }
        else {
            console.log(`${dirName}/${item.ObjectID} Success\n`);
        }
    });
}

const getPIHierarchy = async function(header) {

    const url = encodeURI(`${basePath}/typedefinition?query=(Parent.Name = "Portfolio Item")&fetch=Name,Ordinal,TypePath&order=Ordinal DESC`);
    console.log(`Getting PI Hierarchy: ${url}`);
    const response = await fetch(url, {
        method: 'GET',
        headers: header
    });

    const types = await response.json();

    return types.QueryResult.Results;
};

const getPreliminaryEstimates = async function(header) {

    const url = `${basePath}/preliminaryestimate?fetch=Value,Name,Description,CountValue,ObjectID`;
    const response = await fetch(url, {headers:header, method: 'GET'});
    const rJson = await response.json();
    const estimates = rJson.QueryResult.Results;
    const estimateDict = estimates.reduce((val, estimate) => {
        val[estimate.ObjectID] = estimate.Value;
        return val;
    }, {});

    fs.writeFileSync('preliminary.estimates', JSON.stringify(estimateDict));
};

const getReleases = async function(header, projectUuid) {

    const url = encodeURI(`${basePath}/release?project=/project/${projectUuid}&projectScopeDown=false&fetch=Name,ReleaseDate,ReleaseStartDate,ObjectID,Project&pagesize=2000`);
    console.log(`Getting releases: ${url}`);
    const response = await fetch(url, {headers: header, method: 'GET'});
    const rJson = await response.json();
    const releases = rJson.QueryResult.Results;

    releases.forEach(rel => {
        writeTheThing(RELEASE_DIR, rel);
    });

    return releases;
};

const traceOutChildren = function(parent, kids) {

    const strOut = kids.reduce((str, kid) => {
        str = `${str}, ${kid.FormattedID}`;
        return str;
    }, `${parent.FormattedID}: `);
};

const getChildren = async function(parent, header) {

    const childrenCount = (parent.UserStories) ? parent?.UserStories?.Count : parent?.Children?.Count;
    const childRef = (parent.UserStories) ? parent?.UserStories?._ref : parent?.Children?._ref;

    if (!childrenCount || childrenCount == 0) {
        return;
    }

    const url = encodeURI(`${childRef}?pagesize=2000&fetch=Name,Description,PlanEstimate,RefinedEstimate,PreliminaryEstimate,Release,ObjectID,FormattedID,UserStories,Children,Project,DisplayColor`);
    const response = await fetch(url, {method: 'GET', headers: header});
    const childs = await response.json();
    parent.realChildren = [];
    console.log(childRef);
    console.log(`${parent.FormattedID} has ${childs.QueryResult.Results.length} children`);

    for ( let i = 0; i < childs?.QueryResult?.Results?.length; i++) {
        const c = childs.QueryResult.Results[i];
        const result = await getChildren(c, header);
        parent.realChildren.push(c);
    };

    traceOutChildren(parent, parent.realChildren);
    return parent.realChildren;
};

const getItemTree = async function(header, projectUuid, types) {

    const url = encodeURI(`${basePath}/artifacts?types=PortfolioItem/${types[portfolioType].Name}&project=/project/${projectUuid}&projectScopeDown=true&projectScopeUp=false&pagesize=2000&fetch=Children,Name,RefinedEstimate,PreliminaryEstimate,Description,ObjectID,FormattedID,UserStories,Project,DisplayColor`);
    console.log(`Getting artifacts... ${url}`);
    const response = await fetch(url, {headers: header, method: 'GET'});
    const rootItems = await response.json();

    for (let i = 0; i < rootItems.QueryResult.Results.length; i++) {
        const r = rootItems.QueryResult.Results[i];
        r.realChildren = await getChildren(r, header);
    }

    rootItems.QueryResult.Results.forEach(async r => {
        writeTheThing(ITEM_DIR, r);
    });

    return rootItems;
};

const getCapacityPlans = async function(header, projectUuid) {

    const url = encodeURI(`${basePath}/workingcapacityplan?project=/project/${projectUuid}&projectScopeDown=true&projectScopeUp=false&fetch=true&pagesize=2000`);
    console.log(`Getting plans... ${url}`);
    const response = await fetch(url, {headers: header, method: 'GET'});
    const plans = await response.json();

    const fillCollection = (plan) => {
        return async (attr) => {
            if (!plan[attr]._ref) {
                return [];
            }

            const url2 = encodeURI(`${plan[attr]._ref}?pagesize=2000&fetch=true`);
            console.log(`Getting plan details for ${attr}: ${url2}`);
            const r2 = await fetch(url2, {headers: header, method: 'GET'});
            const info = await r2.json();
            return info.QueryResult.Results;
        };
    };

    plans.QueryResult.Results.forEach(async (plan) => {
        const collFx = fillCollection(plan);
        plan.realAssignments = await collFx('Assignments');
        plan.realAssociatedItems = await collFx('AssociatedItems');
        plan.realAssociatedProjects = await collFx('AssociatedProjects');
        plan.realCapacityItems = await collFx('CapacityPlanItems');
        plan.realCapacityPlanProjects = await collFx('CapacityPlanProjects');
        plan.realChildCapacityPlans = await collFx('ChildCapacityPlans');

        writeTheThing(PLAN_DIR, plan);
    });
};

const getProjectTree = async function(header, projectId) {
    const url = encodeURI(`${basePath}/project/${projectId}`);
    const pResponse = await fetch(url, {method: 'GET', headers: header});
    const pJson = await pResponse.json();
    const project = pJson.Project;

    project.realChildren = await getChildren(project, header);

    writeTheThing(PROJECT_DIR, project);
    return project;
};

const doTheThings = async function() {
    
    const header = {
        'Content-Type': 'application/json',
        zsessionid: apiKey
    };

    fs.rmSync(RELEASE_DIR, {recursive: true, force: true});
    fs.rmSync(ITEM_DIR, {recursive: true, force: true});
    fs.rmSync(PLAN_DIR, {recursive: true, force: true});
    fs.rmSync(PROJECT_DIR, {recursive: true, force: true});

    fs.mkdirSync(RELEASE_DIR);
    fs.mkdirSync(ITEM_DIR);
    fs.mkdirSync(PLAN_DIR);
    fs.mkdirSync(PROJECT_DIR);

    const project = await getProjectTree(header, projectId);
    const projectUuid = project.ObjectUUID

    const portfolioHierarchy = await getPIHierarchy(header);

    const piDict = {};
    portfolioHierarchy.forEach(pi => {
        piDict[pi.TypePath] = pi.Ordinal;
    });
    fs.writeFileSync(PI_HIERARCHY, JSON.stringify(piDict));
    await getPreliminaryEstimates(header);

    await getReleases(header, projectUuid);

    await getItemTree(header, projectUuid, portfolioHierarchy);
    await getCapacityPlans(header, projectUuid);
};

doTheThings();

