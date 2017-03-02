/* @flow */

import React, { Component } from 'react';
import { getDisplayName, isPromise, propsWithoutInternal } from './utils';
import type { JobState } from './ssr/types';

type Work = (props : Object) => any;

type State = JobState & {
  executingJob?: Promise<any>,
  monitorState?: { [key : string] : mixed },
};

type Props = {
  jobInitState?: JobState,
  onJobProcessed?: (jobState: JobState) => void,
  [key: string]: any,
};

type Config = {
  shouldWorkAgain? : (Object, Object, Object) => boolean,
};

const defaultConfig : Config = { monitorProps: [] };

export default function withJob(work : Work, config : Config = defaultConfig) {
  if (typeof work !== 'function') {
    throw new Error('You must provide a "work" function to the "withJob".');
  }

  const { shouldWorkAgain } = config;

  return function wrapComponentWithJob(WrappedComponent : Function) {
    class ComponentWithJob extends Component {
      props: Props;
      state: State;

      constructor(props : Props) {
        super(props);
        this._ready = false;
        this.state = {
          inProgress: false,
          completed: false,
        };
      }

      componentWillMount() {
        const { jobInitState } = this.props;

        this._ready = !!(typeof window !== 'undefined');

        if (jobInitState) {
          this.setStateSAFE(jobInitState);
          return;
        }

        this.handleWork(this.props);
      }

      componentWillUnmount () {
        this._ready = false;
      }

      componentWillReceiveProps(nextProps : Props) {
        if (!shouldWorkAgain
          || !shouldWorkAgain(
            propsWithoutInternal(this.props),
            propsWithoutInternal(nextProps),
            this.getJobState(),
          )
        ) {
          // User has explicitly stated no!
          return;
        }

        this.handleWork(nextProps);
      }

      isReady() { return !!this._ready; }

      setStateSAFE (state, fn) {
        return this.isReady() ? this.setState(state, fn) : null;
      }

      handleWork(props : Props) {
        if (!this._ready) return;

        const { onJobProcessed } = this.props;
        let workResult;

        try {
          workResult = work(propsWithoutInternal(props));
        } catch (error) {
          // Either a syncrhnous error or an error setting up the asynchronous
          // promise.
          this.setStateSAFE({ completed: true, error });
          return;
        }

        if (isPromise(workResult)) {
          workResult
            .then((result) => {
              this.setStateSAFE({ completed: true, inProgress: false, result });
              return result;
            })
            .catch((error) => {
              this.setStateSAFE({ completed: true, inProgress: false, error });
            })
            .then(() => {
              if (onJobProcessed) {
                onJobProcessed(this.getJobState());
              }
            });

          // Asynchronous result.
          this.setStateSAFE({ completed: false, inProgress: true, executingJob: workResult });
        } else {
          // Synchronous result.
          this.setStateSAFE({ completed: true, result: workResult });
        }
      }

      getExecutingJob() {
        return this.state.executingJob;
      }

      getJobState() : JobState {
        const { completed, inProgress, result, error } = this.state;
        return { completed, inProgress, result, error };
      }

      getPropsWithJobState(props : Object) {
        return Object.assign(
          {},
          // Do not pass down internal props
          propsWithoutInternal(props),
          { job: this.getJobState() },
        );
      }

      render() {
        return <WrappedComponent {...this.getPropsWithJobState(this.props)} />;
      }
    }
    ComponentWithJob.displayName = `${getDisplayName(WrappedComponent)}WithJob`;
    return ComponentWithJob;
  };
}
