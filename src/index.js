import 'bootstrap/dist/js/bootstrap';
import ScatterPlot from 'candela/plugins/vega/ScatterPlot';
import { select,
         selectAll } from 'd3-selection';
import { json } from 'd3-request';
import dl from 'datalib';

import { action,
         store,
         observeStore } from './redux';
import stringToElement from './util/stringToElement';
import { NormalPlot } from './util/stats';
import { allVars } from './util';
import data from '../data/index.yml';
import varTemplate from './template/var.jade';
import body from './index.jade';
import './index.less';
import models from './tangelo/models.yml';

// Construct a require context for the available data files.
const dataReq = require.context('../data/csv', false, /\.csv$/);

// Install the content template.
select(document.body).html(body());

// Install the dataset list.
store.dispatch(action.setDatasetList(data));

// Install the model choices.
select('ul.model-menu')
  .selectAll('li')
  .data([
    'linear',
    'quadratic',
    'loess'
  ])
  .enter()
  .append('li')
  .append('a')
  .attr('href', '#')
  .text(d => d)
  .on('click', d => {
    store.dispatch(action.setModelType(d));
  });

// When the active dataset changes, set the dropdown menu's text to the name of
// the dataset.
observeStore(next => {
  const index = next.getIn(['data', 'which']);
  const sel = select('#navbar a.dropdown-toggle');
  if (index === -1) {
    sel.html('Select dataset <span class="caret"></span>');
  } else {
    const dataset = next.getIn(['data', 'datasets', index]);
    sel.html(`${dataset.get('name')} <span class="caret"></span>`);
  }
}, s => s.getIn(['data', 'which']));

// When the active data changes, populate the variables panel.
observeStore(next => {
  const immData = next.getIn(['data', 'data']);

  // Clear the variables panel.
  const panel = select('#vars .panel');
  panel.selectAll('*').remove();

  // Bail if there's no data.
  if (immData === null) {
    return;
  }

  // Extract the list of variable names.
  const data = immData.toJS();
  const names = Object.keys(data[0]);

  // Gather up a list of new variables to create.
  const vars = names.map(name => ({
    name,
    data: data.map(datum => datum[name])
  }));

  // Set these variables as the application's "original variables".
  //
  // NOTE: if this is not done in a timeout callback, it results in a weird
  // infinite loop for some reason.
  window.setTimeout(() => store.dispatch(action.setVariables(vars)), 0);
}, s => s.getIn(['data', 'data']));

const varsChanged = (origVars, logVars) => {
  const vars = [].concat(origVars, logVars);

  const fillMenu = (sel, which, act) => {
    const menu = sel.selectAll('li')
      .data(vars);

    menu.enter()
      .append('li')
      .append('a')
      .attr('href', '#')
      .text(d => d.name)
      .on('click', d => {
        store.dispatch(act(which, d));
      });

    menu.exit()
      .remove();
  };

  // Fill the variable menus in the exploratory vis section.
  fillMenu(select('.variable1'), 0, action.setExploratoryVar);
  fillMenu(select('.variable2'), 1, action.setExploratoryVar);
};

observeStore(next => {
  const vars = next.get('vars').toJS();

  selectAll('.original-variables')
    .classed('hidden', vars.length === 0);

  const logVars = next.get('logVars').toJS();
  selectAll('.exploratory-vis,.modeling')
    .classed('hidden', vars.length + logVars.length === 0);

  varsChanged(vars, logVars);

  const panels = select('#vars .panel')
    .selectAll('.panel-heading')
    .data(vars)
    .enter()
    .append(d => stringToElement(varTemplate({
      name: d.name,
      button: true
    })));

  panels.select('.panel-body')
    .select('.vis')
    .each(function (d) {
      const vis = new NormalPlot(this, { // eslint-disable-line no-unused-vars
        data: d.data,
        opacity: 0.9,
        width: 300,
        height: 200
      });
      vis.render();
    });

  panels.select('.log')
    .on('click', d => {
      const data = d.data.map(x => Math.log(x))
        .filter(x => isFinite(x));

      store.dispatch(action.createLogVariable(d.name, data));
    });
}, s => s.get('vars'));

// When the list of datasets changes, populate the dropdown menu.
observeStore(next => {
  const datasets = next.getIn(['data', 'datasets']).toJS();
  const sel = select('#navbar ul.dropdown-menu')
    .selectAll('li')
    .data(datasets, d => d.key || d.name);

  sel.exit()
    .remove();

  sel.enter()
    .append('li')
    .append('a')
    .attr('href', '#')
    .html(d => d.name)
    .on('click', (d, i) => {
      store.dispatch(action.setActiveDataset(i));

      const dataRaw = dataReq(`./${d.key || d.name}.csv`);
      const data = dl.read(dataRaw, {
        type: 'csv',
        parse: 'auto'
      });
      store.dispatch(action.setActiveData(data));
    });
}, s => s.getIn(['data', 'datasets']));

// When the list of derived log transform variables changes, update the
// clickable state of the log transform buttons, and the list of log-variable
// panels.
observeStore(next => {
  const logVars = next.get('logVars').toJS();

  selectAll('.derived-variables')
    .classed('hidden', logVars.length === 0);

  const vars = next.get('vars').toJS();
  selectAll('.exploratory-vis,.modeling')
    .classed('hidden', vars.length + logVars.length === 0);

  varsChanged(vars, logVars);

  // Disable "compute log transform" buttons for variables that have already
  // been log-transformed.
  select('#vars .panel')
    .selectAll('.log')
    .each(function (d) {
      const logName = `log_${d.name}`;
      let disabled = false;
      logVars.forEach(logvar => {
        if (logvar.name === logName) {
          disabled = true;
        }
      });

      select(this).attr('disabled', disabled ? true : null);
    });

  select('#logvars .panel')
    .selectAll('.panel-heading')
    .data(logVars)
    .enter()
    .append(d => stringToElement(varTemplate({
      name: d.name,
      button: false
    })))
    .select('.panel-body')
    .select('.vis')
    .each(function (d) {
      const vis = new NormalPlot(this, { // eslint-disable-line no-unused-vars
        data: d.data,
        opacity: 0.9,
        width: 300,
        height: 200
      });
      vis.render();
    });
}, s => s.get('logVars'));

// When the exploratory vis variables change, update the menus.
observeStore(next => {
  const exploratoryVis = next.get('exploratoryVis');

  // Collect the variable data.
  const get = key => {
    let x = exploratoryVis.get(key);
    if (x !== null) {
      x = x.toJS();
    }
    return x;
  };
  const xVar = get('xVar');
  const yVar = get('yVar');

  // Set the text on the dropdown menus.
  const setName = (which, label, v) => {
    select(which)
      .text(v ? `${label}: ${v.name}` : label);
  };
  setName('button.var1', 'X', xVar);
  setName('button.var2', 'Y', yVar);

  // If both variables are selected, display a scatterplot of them.
  if (xVar && yVar) {
    const data = xVar.data.map((d, i) => ({
      x: d,
      y: yVar.data[i]
    }));

    const el = select('#linmodel .vis');
    el.selectAll('*')
      .remove();

    const vis = new ScatterPlot(el.node(), { // eslint-disable-line no-unused-vars
      data,
      x: 'x',
      y: 'y',
      opacity: 0.9,
      width: 600,
      height: 600
    });
    vis.render();
  }
}, s => s.get('exploratoryVis'));

// When the model changes, update the input variables.
observeStore(next => {
  const model = next.getIn(['modeling', 'model']);
  let buttons = [];

  switch (model) {
  case 'linear':
  case 'loess':
    buttons.push({
      variableName: 'predictor_variables',
      displayName: 'predictor'
    });
    buttons.push({
      variableName: 'response',
      displayName: 'response'
    });
    break;

  case 'quadratic':
    buttons.push({
      variableName: 'predictor_variables',
      displayName: 'predictor'
    });
    buttons.push({
      variableName: 'response',
      displayName: 'response'
    });
    buttons.push({
      variableName: 'quadratic_variables',
      displayName: 'quadratic'
    });
    break;

  case null:
    break;

  default:
    throw new Error(`illegal model type: ${model}`);
  }

  select('button.model')
    .text(model === null ? 'Model' : `Model: ${model}`);

  select('.model-vars')
    .selectAll('*')
    .remove();

  const sel = select('.model-vars')
    .selectAll('span.dropdown')
    .data(buttons)
    .enter()
    .append('span')
    .classed('dropdown', true);

  sel.append('button')
    .classed('btn btn-default dropdown-toggle', true)
    .each(function (d) {
      select(this)
        .classed(d.variableName, true);
    })
    .attr('data-toggle', 'dropdown')
    .text(d => d.displayName[0].toUpperCase() + d.displayName.slice(1));

  sel.append('ul')
    .classed('dropdown-menu', true)
    .each(function (d) {
      select(this)
        .classed(`${d.displayName}-menu`, true);
    })
    .selectAll('li')
    .data(d => {
      const vars = allVars();
      return vars.map(v => Object.assign({}, v, {
        variableName: d.variableName,
        displayName: d.displayName
      }));
    })
    .enter()
    .append('li')
    .append('a')
    .attr('href', '#')
    .text(d => d.name)
    .on('click', d => {
      store.dispatch(action.setModelingVar(d.variableName, d));
    });

  window.setTimeout(() => store.dispatch(action.setModelInputVars(null)), 0);
  window.setTimeout(() => store.dispatch(action.setModelInputVars(buttons.map(x => x.variableName))), 0);
}, s => s.getIn(['modeling', 'model']));

// When the modeling vis variables change, update the menus.
observeStore((next, last) => {
  if (last && last.getIn(['modeling', 'inputVars']) === null) {
    return;
  }

  const modeling = next.getIn(['modeling', 'inputVars']);

  if (modeling === null) {
    return;
  }

  // Collect the variable data.
  const get = key => {
    let x = modeling.get(key);
    if (x !== null) {
      x = x.toJS();
    }
    return x;
  };

  const inputVars = modeling.toJS();
  const vars = Object.keys(inputVars).map(get);

  // Set the text on the dropdown menus.
  const setName = (which, label, v) => {
    select(which)
      .text(v ? `${label}: ${v.name}` : label);
  };
  Object.keys(inputVars).forEach(k => {
    const v = inputVars[k];
    if (v !== null) {
      setName(`button.${v.variableName}`, v.displayName, v);
    }
  });

  // If all variables are selected, run a model and display the results.
  if (vars.indexOf(null) < 0) {
    // Construct a data table.
    let data = {};
    vars.forEach(v => {
      data[v.name] = v.data;
    });

    // Construct a Tangelo service URL.
    let url = `d3mLm/${next.getIn(['modeling', 'model'])}?data=${JSON.stringify(data)}`;
    vars.forEach(v => {
      url += `&${v.variableName}="${v.name}"`;
    });

    // Execute the service and display the result.
    json(url, resp => {
      select('pre.info')
        .classed('hidden', false)
        .text(JSON.stringify(resp, null, 2));
    });
  }
}, s => s.getIn(['modeling', 'inputVars']));
