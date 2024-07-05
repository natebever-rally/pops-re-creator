import readline from 'readline-sync';
import fetch from 'node-fetch';
import fs, { write } from 'fs';
import { release, type } from 'os';

const PI_HIERARCHY = 'old_pi_hierarchy';
const RELEASE_DIR = 'releases.pops';
const PLAN_DIR = 'plans.pops';
const ITEM_DIR = 'items.pops';
const PROJECT_DIR = 'project.pops';
const PROJECT_DICT = 'project.dict';
const OLD_PRELIMINARY = 'preliminary.estimates';

const RELEASE_DICT = 'release.dict';
const ITEM_DICT = 'item.dict';

const baseRallyURLInput = readline.question('Rally Instance [https://rally1.rallydev.com]:');
const baseRallyURL = (!baseRallyURLInput || baseRallyURLInput.length === 0) ? 'https://rally1.rallydev.com' : baseRallyURLInput;

const baseAPIPath = '/slm/webservice/v2.0';
const basePath = `${baseRallyURL}${baseAPIPath}`;

const apiKey = readline.question('APIKey: ');

const workspaceId = readline.question('Workspace ID: ');
const projectId = readline.question('Parent project ID: ');

let projectDict = {};
const planDict = {};
let releaseDict = {};
let itemDict = {};
const newPiDict = {};
let oldPiDict = {};
let preliminaryDict = {};

/****** generic *******/

const getObjectIdFromRef = function(ref) {
    return parseInt(ref.substring(ref.lastIndexOf('/') + 1));
};

const getReleaseKey = function(item) {
    return `${item.Release.Name}__${item.Project._refObjectName}`
};

const singleThreadFetch = async function(url, options, times = 0) {

    const response = await fetch(url, options);
    const result = await response.json();

    if (result.CreateResult.Errors.length > 0) {
        console.log(`Retrying ${url}`);
        return await singleThreadFetch(url, options, times + 1);
    }
    else {
        return result;
    }
}

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

        const result = await singleThreadFetch(url, {body: JSON.stringify(body), method: 'POST', headers: header});
        const newItem = result.CreateResult.Object;

        if (!newItem) {
            console.log('Failure');
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

    console.log(`Building ${item.Name}`);

    return body;
};

const completeReleaseDict = async function(header, project) {

    // get Release Names from pops
    const files = fs.readdirSync(RELEASE_DIR);

    for (let i = 0; i< files.length; i++) {
        const file = files[i];

        const oldRelease = JSON.parse(fs.readFileSync(`${RELEASE_DIR}/${file}`, 'utf-8'));
        releaseDict[`${oldRelease.Name}__${oldRelease.Project._refObjectName}`] = releaseDict[file];
    };
};

/****** Items *********/

const buildItemBody = function(item, parent) {

    const innerBody = {
        'Name': item.Name,
        'Description': item.Description,
        'Release': (item.Release) ? `/release/${releaseDict[getReleaseKey(item)]}` : null,
        'PlanEstimate': item.PlanEstimate,
        'RefinedEstimate': item.RefinedEstimate,
        'PreliminaryEstimate': (item.PreliminaryEstimate) ? preliminaryDict[item.PreliminaryEstimate.ObjectID] : null,
        'Project': (item.Project) ? `/project/${projectDict[item.Project.ObjectID]}` : projectId,
        'DisplayColor': item.DisplayColor
    };

    if (item.Release && !releaseDict[getReleaseKey(item)]) {
        console.log('Cannot find release');
    }

    const key = (item._type === 'HierarchicalRequirement') ? 'UnifiedParent' : 'Parent';
    
    if (parent) {
        innerBody[key] = `/${parent._type}/${parent.ObjectID}`;
    }

    const topKey = item._type === 'HierarchicalRequirement' ? item._type :
        `PortfolioItem/${newPiDict[oldPiDict[item._type]].replace(' ', '')}`;

    const body = {
        [`${topKey}`]: innerBody
    };

    return body;
};

const buildItemUrl = function(item) {
    const newType = newPiDict[oldPiDict[item._type]];
    const typeStrings = (newType) ? 
        newType.startsWith('PortfolioItem') ? newType : `/portfolioitem/${newType}`
        :
        'hierarchicalrequirement';
    const url = `${basePath}/${typeStrings}/create?workspace=/workspace/${workspaceId}`.replace(' ', '');
    return url;
}

/****** Projects ******/

const buildProjectUrl = function(project) {
    return `${basePath}/project/create`;
};

const buildProjectBody = function(project, parent) {

    const parentId = (parent) ? parent.ObjectID : projectId;
    project.Parent = `/project/${parentId}`;

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

const writeDict = function(filename, dictToWrite) {
    fs.writeFileSync(filename, JSON.stringify(dictToWrite));
};

const getProject = async function(header, projectId) {

    const url = encodeURI(`${basePath}/project/${projectId}`);
    const pResponse = await fetch(url, {method: 'GET', headers: header});
    const pJson = await pResponse.json();
    const project = pJson.Project;
    return project;
};

/** Plan stuff ***********************************/

const loadPlans = async function(header, project) {

    // separate plans into plans with parents and those without.
    const dirs = fs.readdirSync(PLAN_DIR);
    const allPlans = dirs.map(file => {
        return JSON.parse(fs.readFileSync(`${PLAN_DIR}/${file}`, 'utf-8'));
    });

    const noParentPlans = allPlans.filter(plan => {
        return plan.ParentCapacityPlan === null;
    });

    const plansWithParents = allPlans.filter(plan => {
        return plan.ParentCapacityPlan !== null;
    });

    const typeMapping = await buildTypeMapping(header);
        
    // build plans with no parents first
    for (let i = 0; i < noParentPlans.length; i++) {
        await buildPlan(header, project, noParentPlans[i], typeMapping);
    }

    // build plans with parents next
    for (let j = 0; j < plansWithParents.length; j++) {
        await buildPlan(header, project, plansWithParents[j], typeMapping);
    }
};

const makeBatchEntry = function(path, body) {
    return { Entry: { Path: path, Method: 'POST', Body: body } };
};

const addProjectsToPlan = function(plan, batchList) {

    // adding the projects
    const capacityPlanProjectDict = plan.realCapacityPlanProjects.reduce( (capacityPlanProjectDict, aProject) => {

        const projectBody = {
            CapacityPlanProject: {
                CapacityPlan: '/workingcapacityplan/{{0}}',
                Project: `/project/${projectDict[getObjectIdFromRef(aProject.Project._ref)]}`,
                PlannedCapacityCount: aProject.PlannedCapacityCount,
                PlannedCapacityPoints: aProject.PlannedCapacityPoints
            }
        };

        // first time will be 1 because the plan is at index 0... 
        capacityPlanProjectDict[aProject.ObjectID] = batchList.length;
        batchList.push(makeBatchEntry(`/capacityplanproject/create?workspace=/workspace/${workspaceId}`, projectBody));
        return capacityPlanProjectDict;
    }, {});

    return capacityPlanProjectDict;
};

const addItemsToPlan = function(plan, typeMapping, batchList) {

    // adding the items
    const capacityPlanItemDict = plan.realCapacityItems.reduce((capacityPlanItemDict, anItem, index) => {

        const objectId = getObjectIdFromRef(anItem.PortfolioItem._ref);
        const portfolioItemId = itemDict[objectId];

        console.log(`Adding ${plan.realAssociatedItems[index].Name}`);

        const itemBody = {
            CapacityPlanItem: {
                CapacityPlan: '/workingcapacityplan/{{0}}',
                PortfolioItem: `/PortfolioItem/${typeMapping[anItem.PortfolioItem._type].Name}/${portfolioItemId}`
            }
        };

        capacityPlanItemDict[anItem.ObjectID] = batchList.length;
        batchList.push(makeBatchEntry('/capacityplanitem/create', itemBody)); 
        return capacityPlanItemDict;
    }, {});

    return capacityPlanItemDict;
};

const addAssignmentsToPlan = function(plan, capacityPlanItemDict, capacityPlanProjectDict, batchList) {
    // adding the assignments
    plan.realAssignments.forEach(assignment => {
        const itemBody = {
            CapacityPlanAssignment: {
                CapacityPlanItem: `/capacityplanItem/{{${capacityPlanItemDict[getObjectIdFromRef(assignment.CapacityPlanItem._ref)]}}}`,
                CapacityPlanProject: `/capacityplanproject/{{${capacityPlanProjectDict[getObjectIdFromRef(assignment.CapacityPlanProject._ref)]}}}`,
                AllocationPoints: assignment.AllocationPoints,
                AllocationCount: assignment.AllocationCount
            }
        };

        batchList.push(makeBatchEntry('/capacityplanassignment/create', itemBody));
    });
};

const buildPlan = async function(header, project, plan, typeMapping) {

    const url = encodeURI(`${basePath}/batch?fetch=true`);

    const endReleaseKey = `${plan.EndRelease._refObjectName}__${plan.Project._refObjectName}`;
    const startReleaseKey = `${plan.StartRelease._refObjectName}__${plan.Project._refObjectName}`;

    const body = {
        "workingcapacityplan": {
            Name: plan.Name,
            EndRelease: `/release/${releaseDict[endReleaseKey]}`,
            StartRelease: `/release/${releaseDict[startReleaseKey]}`,
            EstimationType: plan.EstimationType,
            HierarchyType: plan.HierarchyType,
            ProjectMode: plan.ProjectMode,
            ItemTypeDef: `/typedefinition/${getObjectIdFromRef(typeMapping[`PortfolioItem/${plan.ItemTypeDef._refObjectName}`]._ref)}`,
            Project: `/project/${projectDict[getObjectIdFromRef(plan.Project._ref)]}`,
            Workspace: `/workspace/${workspaceId}`
        }
    };

    const batchList = [];
    // 0th request
    batchList.push(makeBatchEntry('/workingcapacityplan/create', body));

    // the batch index for a particular item.
    const capacityPlanProjectDict = addProjectsToPlan(plan, batchList);
    const capacityPlanItemDict = addItemsToPlan(plan, typeMapping, batchList);
    addAssignmentsToPlan(plan, capacityPlanItemDict, capacityPlanProjectDict, batchList);

    const batchBody =  {
        Batch: batchList
    };

    const response = await fetch(url, {method: 'POST', body: JSON.stringify(batchBody), headers: header});
    const result = await response.json();
    const newPlan = result.BatchResult.Results[0].Object;
    planDict[plan.ObjectID] = newPlan;

    console.log(`Created Plan: ${plan.Name}`);

    // set parent if it has one
    if (plan.ParentCapacityPlan) {
        const url = encodeURI(`${basePath}/workingcapacityplan/${newPlan.ObjectID}`);

        const parentPlan = planDict[getObjectIdFromRef(plan.ParentCapacityPlan._ref)];
        const parentProjectName = parentPlan.Project._refObjectName;

        const body = {
            WorkingCapacityPlan: {
                ParentCapacityPlan: `/workingcapacityplan/${parentPlan.ObjectID}`,
                TargetRelease: `/release/${releaseDict[plan.StartRelease._refObjectName + '__' + parentProjectName]}`,
                TargetProject: `/project/${projectDict[getObjectIdFromRef(plan.Project._ref)]}`
            }
        };

        const response = await fetch(url, {headers: header, method: 'POST', body: JSON.stringify(body)});
        const result = await response.json();
        console.log('setting parent...');
    }
};

const buildTypeMapping = async function(headers) {

   const oldPiDict = JSON.parse(fs.readFileSync(PI_HIERARCHY, 'utf-8'));
   const piTypes = await getPIHierarchy(headers);

    // create a [old common name]: new typedef
    const mapping = Object.entries(oldPiDict).reduce((m, entry) => {
        const [key, value] = entry;
        const newType = piTypes.find(type => {
            return type.Ordinal === value;
        });

        m[key] = newType;
        return m;
    }, {});

    return mapping;
};

/** */

const getPIHierarchy = async function(header) {

    const url = encodeURI(`${basePath}/typedefinition?query=(Parent.Name = "Portfolio Item")&workspace=/workspace/${workspaceId}&fetch=Name,Ordinal&order=Ordinal DESC`);
    console.log(`Getting PI Hierarchy: ${url}`);
    const response = await fetch(url, {
        method: 'GET',
        headers: header
    });

    const types = await response.json();

    return types.QueryResult.Results;
};

const createPreliminaryMappings = async function(header) {

    preliminaryDict = JSON.parse(fs.readFileSync(OLD_PRELIMINARY, 'utf-8'));
    
    const url = `${basePath}/preliminaryestimate?workspace=/workspace/${workspaceId}&fetch=Value,Name,Description,CountValue,ObjectID`;
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

};

const doProjects = async function(headers, project) {
    if (fs.existsSync(PROJECT_DICT)) {
        console.log('Loading existing project dictionary...');
        projectDict = JSON.parse(fs.readFileSync(PROJECT_DICT, 'utf-8'));
    }
    else {
        await loadThings(headers, project, PROJECT_DIR, buildThing(buildProjectUrl, buildProjectBody, projectDict));
        writeDict(PROJECT_DICT, projectDict);
    }
};

const doReleases = async function(headers, project) {
    if (fs.existsSync(RELEASE_DICT)) {
        console.log('Loading existing release dictionary...');
        releaseDict = JSON.parse(fs.readFileSync(RELEASE_DICT, 'utf-8'));
    }
    else {
        await loadThings(headers, project, RELEASE_DIR, buildThing(buildReleaseUrl, buildReleaseBody, releaseDict));
        await completeReleaseDict(headers, project);
        writeDict(RELEASE_DICT, releaseDict);
    }
};

const doItems = async function(headers, project) {
    if (fs.existsSync(ITEM_DICT)) {
        console.log('Loading existing item dictionary...');
        itemDict = JSON.parse(fs.readFileSync(ITEM_DICT, 'utf-8'));
    }
    else {
        await loadThings(headers, project, ITEM_DIR, buildThing(buildItemUrl, buildItemBody, itemDict));
        writeDict(ITEM_DICT, itemDict);
    }
};

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

    await doProjects(headers, project);
    await doReleases(headers, project);
    await doItems(headers, project);

    await loadPlans(headers, project, piTypes);
};

doIt();