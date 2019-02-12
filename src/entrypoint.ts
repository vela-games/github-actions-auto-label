import * as fs from 'fs';
import * as path from 'path';
import { Toolkit } from 'actions-toolkit';
import { pick, values } from 'lodash';
import * as micromatch from 'micromatch';
import {
  addLabelsToLabelable,
  removeLabelsFromLabelable,
  getPullRequestAndLabels,
} from './query';
import { Label, FileEdge, LabelEdge, LabelName } from './interface';
import * as util from 'util';

const exec = util.promisify(require('child_process').exec);
const configFile = '.github/auto-label.json';
const tools = new Toolkit({
  event: ['pull_request.opened', 'pull_request.synchronize'],
});

const getLabelIds = (allLabels: Label[], labelNames: LabelName[]) =>
  JSON.stringify(values(pick(allLabels, labelNames)));

(async () => {
  if (!fs.existsSync(path.join(tools.workspace, configFile))) {
    tools.exit.neutral('config file does not exist.');
  }

  const config = JSON.parse(tools.getFile(configFile));

  let result;

  try {
    result = await getPullRequestAndLabels(tools, tools.context.issue());
  } catch (error) {
    console.error('Request failed: ', error.request, error.message);
    tools.exit.failure('getPullRequestAndLabels has been failed. ');
  }

  // tslint:disable-next-line:no-console
  console.log('result: ', result);

  const allLabels = result.repository.labels.edges.reduce(
    (acc: Label, edge: LabelEdge) => {
      acc[edge.node.name] = edge.node.id;
      return acc;
    },
    {},
  );

  // tslint:disable-next-line:no-console
  console.log('allLabels: ', allLabels);

  const currentLabelNames = new Set(
    result.repository.pullRequest.labels.edges.map(
      (edge: LabelEdge) => edge.node.name,
    ),
  );

  // tslint:disable-next-line:no-console
  console.log('currentLabelNames: ', currentLabelNames);

  // TODO: handle stderr
  const { stdout, stderr } = await exec(
    `git diff --name-only $(git merge-base ${result.repository.pullRequest.headRefOid} ${result.repository.pullRequest.baseRefOid})`,
  );

  // tslint:disable-next-line:no-console
  console.log('stdout: ', stdout);

  const diffFiles = stdout.trim().split('\n');

  // tslint:disable-next-line:no-console
  console.log('diffFiles: ', diffFiles);

  const newLabelNames = new Set(
    diffFiles.reduce((acc: LabelName[], file: string) => {
      (Object.entries(config.rules) as []).forEach(
        ([label, pattern]: [string, string | string[]]) => {
          if (micromatch.any(file, pattern)) {
            acc.push(label);
          }
        },
      );
      return acc;
    }, []),
  );

  // tslint:disable-next-line:no-console
  console.log('newLabelNames: ', newLabelNames);

  const ruledLabelNames = new Set(Object.keys(config.rules));

  // tslint:disable-next-line:no-console
  console.log('ruledLabelNames: ', ruledLabelNames);

  const labelNamesToAdd = new Set(
    ([...newLabelNames] as LabelName[]).filter(
      labelName => !currentLabelNames.has(labelName),
    ),
  );

  // tslint:disable-next-line:no-console
  console.log('labelNamesToAdd: ', labelNamesToAdd);

  const labelNamesToRemove = new Set(
    ([...currentLabelNames] as LabelName[]).filter(
      (labelName: string) =>
        !newLabelNames.has(labelName) && ruledLabelNames.has(labelName),
    ),
  );

  // tslint:disable-next-line:no-console
  console.log('labelNamesToRemove: ', labelNamesToRemove);

  const labelableId = result.repository.pullRequest.id;

  // tslint:disable-next-line:no-console
  console.log('labelableId: ', labelableId);

  if (labelNamesToAdd.size > 0) {
    try {
      const foo = await addLabelsToLabelable(tools, {
        labelIds: getLabelIds(allLabels, [...labelNamesToAdd] as LabelName[]),
        labelableId,
      });
      // tslint:disable-next-line:no-console
      console.log('hi1: ', foo);
    } catch (error) {
      console.error('Request failed: ', error.request, error.message);
      tools.exit.failure('addLabelsToLabelable has been failed. ');
    }
  }

  if (labelNamesToRemove.size > 0) {
    try {
      await removeLabelsFromLabelable(tools, {
        labelIds: getLabelIds(allLabels, [
          ...labelNamesToRemove,
        ] as LabelName[]),
        labelableId,
      });
    } catch (error) {
      // tslint:disable-next-line:no-console
      console.log('hi2: ');

      console.error('Request failed: ', error.request, error.message);
      tools.exit.failure('removeLabelsFromLabelable has been failed. ');
    }
  }
})();
