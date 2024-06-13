import readline from 'readline-sync';
import fetch from 'node-fetch';
import fs, { write } from 'fs';

const PI_HIERARCHY = 'old_pi_hierarchy';
const RELEASE_DIR = 'releases.pops';
const PLAN_DIR = 'plans.pops';
const ITEM_DIR = 'items.pops';
const PROJECT_DIR = 'project.pops';
const PROJECT_DICT = 'project.dict';
const OLD_PRELIMINARY = 'preliminary.estimates';

const baseRallyURL = 'https://nbever.testn.f4tech.com/';//'https://rally1.rallydev.com';
const baseAPIPath = '/slm/webservice/v2.0';
const basePath = `${baseRallyURL}${baseAPIPath}`;

const apiKey = readline.question('APIKey: ');

const workspaceId = realine.question('Workspace ID: ');
const projectId = readline.question('Parent project ID: ');

let projectDict = {};
const releaseDict = {};
const itemDict = {};
const newPiDict = {};
let oldPiDict = {};
let preliminaryDict = {};

/****** generic *******/

const getReleaseKey = function(item) {
    return `${item.Name}__${projectDict[item.Project.ObjectID]}`
};

const loadThings = async function(header, project, dir, buildThings) {

    const dirs = fs.readdirSync(dir);
    
    for (let i = 0; i < dirs.length; i++) {
        const f = dirs[i];
        const realItem = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf-8'));
        await buildThings(header, project, realItem, null);
    }
}

const buildThing = function(buildUrl, buildBody, dictToUse) {
    
    return async function (header, project, item, parent) {
        const body = buildBody(item, parent, dictToUse);
        const url = encodeURI(buildUrl(item));

        const response = await fetch(url, {body: JSON.stringify(body), method: 'POST', headers: header});
        const result = await response.json();
        const newItem = result.CreateResult.Object;

        if (!newItem) {
            console.error(`Failure: ${result.CreateResult.Errors[0]}`);
            console.error(`URL: ${url}`);
            return;
        }

        console.log(`${newItem.ObjectID}: Success`);

        dictToUse[item.ObjectID] = newItem.ObjectID

        if (!item.realChildren || item.realChildren.length === 0) {
            return;
        }

        const buildFx = buildThing(buildUrl, buildBody, dictToUse);

        for (let i = 0; i < item.realChildren.length; i++) {
            const child = item.realChildren[i];
            await buildFx(header, project, child, newItem);
        }
    };
}

/****** Releases *******/

const buildReleaseUrl = function(release) {

    const url = `${basePath}/release/create?cascade=true`;
    return url;
};

const buildReleaseBody = function(item, parent) {

    const body = {
        'Release': {
            'Name': item.Name,
            'ReleaseDate': item.ReleaseDate,
            'ReleaseStartDate': item.ReleaseStartDate,
            'State': 'Planning',
            'Project': `/project/${projectDict[item.Project.ObjectID]}`
        }
    };

    return body;
};

const completeReleaseDict = async function(header) {

    // get Release Names from pops
    const files = fs.readdirSync(RELEASE_DIR);
    files.forEach( async file => {
        const releaseName = JSON.parse(fs.readFileSync(`${RELEASE_DIR}/${file}`, 'utf-8')).Name;
        const url = encodeURI(`${basePath}/release?projectScopeDown=true&projectScopeUp=true&query=(Name = ${releaseName})&fetch=true`);
        const response = await fetch(url, {method: 'GET', headers: header});
        const result = await response.json();
        const releases = result.QueryResult.Results;
        releases.forEach(r => {
            // this is the new Project ID
            releaseDict[`${item.Name}__${item.Project.ObjectID}`] = r.ObjectID;
        });
    });
};

/****** Items *********/

const buildItemBody = function(item, parent) {

    const innerBody = {
        'Name': item.Name,
        'Description': item.Description,
        'Release': (item.Release) ? releaseDict[getReleaseKey(item)] : null,
        'PlanEstimate': item.PlanEstimate,
        'RefinedEstimate': item.RefinedEstimate,
        'PreliminaryEstimate': (item.PreliminaryEstimate) ? preliminaryDict[item.PreliminaryEstimate.ObjectID] : null,
        'Project': (item.Project) ? `/project/${projectDict[item.Project.ObjectID]}` : projectId,
        'DisplayColor': item.DisplayColor
    };

    const key = (item._type === 'HierarchicalRequirement') ? 'UnifiedParent' : 'Parent';
    
    if (parent) {
        innerBody[key] = `/${parent._type}/${parent.ObjectID}`;
    }

    const body = {
        [`${item._type}`]: innerBody
    };

    return body;
};

const buildItemUrl = function(item) {
    const newType = newPiDict[oldPiDict[item._type]];
    const typeStrings = (newType) ? 
        newType.startsWith('PortfolioItem') ? newType : `/portfolioitem/${newType}`
        :
        'hierarchicalrequirement';
    const url = `${basePath}/${typeStrings}/create`;
    return url;
}

/****** Projects ******/

const buildProjectUrl = function(project) {
    return `${basePath}/project/create`;
};

const buildProjectBody = function(project, parent) {

    const parentId = (parent) ? parent.ObjectID : projectId;
    project.Parent = `/project/${parentId}?fetch=true`;

    const body = {
        'Project': {
            'Name': project.Name,
            'Parent': project.Parent,
            'Workspace': `/workspace/${workspaceId}`,
            'Description': project.Description,
            'State': 'Open'
        }
    };

    return body;
};

const writeProjectDict = function() {
    fs.writeFileSync(PROJECT_DICT, JSON.stringify(projectDict));
};

const getPIHierarchy = async function(header) {

    const url = encodeURI(`${basePath}/typedefinition?query=(Parent.Name = "Portfolio Item")&fetch=Name,Ordinal&order=Ordinal DESC`);
    console.log(`Getting PI Hierarchy: ${url}`);
    const response = await fetch(url, {
        method: 'GET',
        headers: header
    });

    const types = await response.json();

    return types.QueryResult.Results;
};

const getProject = async function(header, projectId) {

    const url = encodeURI(`${basePath}/project/${projectId}`);
    const pResponse = await fetch(url, {method: 'GET', headers: header});
    const pJson = await pResponse.json();
    const project = pJson.Project;
    return project;
};

const createPreliminaryMappings = async function(header) {

    preliminaryDict = JSON.parse(fs.readFileSync(OLD_PRELIMINARY, 'utf-8'));
    
    const url = `${basePath}/preliminaryestimate?fetch=Value,Name,Description,CountValue,ObjectID`;
    console.log(`Getting preliminary estimates: ${url}`);
    const response = await fetch(url, {headers:header, method: 'GET'});
    const rJson = await response.json();
    const estimates = rJson.QueryResult.Results;

    Object.keys(preliminaryDict).forEach(key => {
        const value = preliminaryDict[key];

        const mapValue = estimates.reduce((val, estimate) => {
            const testValue = estimate.Value;
            const diff = Math.abs(testValue - value);

            if (diff < val.difference) {
                return {key: estimate.ObjectID, difference: diff};
            }

            return val;
        }, {key: null, difference: Number.MAX_SAFE_INTEGER});

        preliminaryDict[key] = mapValue.key;
    });

}

const doIt = async function() {

    const headers = {
        zsessionid: apiKey,
        'Content-Type': 'application/json'
    };

    const project = await getProject(headers, projectId);
    projectDict[project.ObjectID] = project.ObjectID;

    const piTypes = await getPIHierarchy(headers);
    piTypes.forEach(piType => {
        newPiDict[piType.Ordinal] = piType.Name;
    });
    oldPiDict = JSON.parse(fs.readFileSync(PI_HIERARCHY, 'utf-8'));

    await createPreliminaryMappings(headers);

    if (fs.existsSync(PROJECT_DICT)) {
        console.log('Loading existing project dictionary...');
        projectDict = JSON.parse(fs.readFileSync(PROJECT_DICT, 'utf-8'));
    }
    else {
        await loadThings(headers, project, PROJECT_DIR, buildThing(buildProjectUrl, buildProjectBody, projectDict));
        writeProjectDict();
    }
    await loadThings(headers, project, RELEASE_DIR, buildThing(buildReleaseUrl, buildReleaseBody, releaseDict));
    await completeReleaseDict(headers);
    await loadThings(headers, project, ITEM_DIR, buildThing(buildItemUrl, buildItemBody, itemDict));
};

doIt();