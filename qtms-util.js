#!/usr/bin/env node
'use strict';
var crutch = require('qtort-microservices').crutch;
var path = require('path');
var uuid = require('uuid');
var serviceid = path.basename(module.id, path.extname(module.id));
var defaults = {
    id: serviceid,
    broker: 'amqp://localhost',
    defaultExchange: 'topic://' + serviceid,
    defaultQueue: serviceid + '-' + uuid.v4().replace(/-/g, ''),
    defaultReturnBody: false,
    d: false,
    'inspect-breakLength': process.stdout.isTTY ? process.stdout.columns : Infinity,
    'inspect-colors': true,
    'inspect-depth': 2,
    'inspect-maxArrayLength': 10,
    'log.levels.[all]': 'INFO',
    'log.levels.microservice-crutch': 'ERROR',
    'log.levels.microservices-crutch': 'ERROR',
    'log.levels.qtort-microservices': 'ERROR',
    'log.levels.firehose': 'DEBUG',
    concurrency: 8,
};

crutch(defaults, function(_, app, fs, inject, logging, options, path, Promise, util) {
    var log = logging.getLogger(options.id);
    var io = new Io();

    _.assign(options, {
        debug: options.debug || options.d || log.isDebugEnabled(),
        simulate: options.simulate || options.s || options.notreally,
    });
    _.assign(options, {
        d: options.debug,
        s: options.simulate,
        notreally: options.simulate,
    });

    return Promise
        .try(onStart)
        .then(() => app.once('ready', () => Promise
            .try(onRunCommand)
            .catch(onError)
            .finally(onStop)
            .done()))
        .catch(onError);

    function onError(error) {
        log.warn('error:', error);
        io.err(error.message || error);
        process.exit(error.code || 9);
    }

    function onStart() {
        var trace = log.isTraceEnabled();
        _.merge(util.inspect, {
            defaultOptions: _(options)
                .pickBy((v, k) => _.startsWith(k, 'inspect-'))
                .mapKeys((v, k) => k.replace(/^inspect-/, ''))
                .value(),
        });

        var utilInspect = util.inspect.bind(util);
        util.inspect = function inspect2(object, options) {
            var filtered = cleanup(object, _.isFunction);
            return utilInspect(filtered, _.defaults(options, {
                depth: _.get(object, 'type') === 'Buffer' && _.has(object, 'data') ? 0 : _.get(utilInspect, 'defaultOptions.depth'),
            }));
        };
        utilInspect.defaultOptions = utilInspect.defaultOptions;

        return Promise
            .try(() => inject.child({
                io: io,
                inspect: util.inspect,
                cleanup: cleanup,
            }))
            .then(inj => Promise
                .props({
                    api: inj(require('./api.js')),
                })
                .then(inj.child))
            .then(inj => inject = inj);
    }

    function onRunCommand() {
        log.trace('onRunCommand| attempting to start command');

        let parts = _(_.trim(options._[0] || 'help').split('.'))
            .concat(_.drop(options._))
            .map(_.ary(_.trim, 1))
            .value();

        let modname = parts.shift();
        let modpath = path.join(path.dirname(module.filename), 'commands', modname + '.js');
        if (!fs.existsSync(modpath)) {
            return io.err('Invalid command %s, use help command for valid commands.', modname);
        }

        let cmdpath = modname;
        return inject(require(modpath))
            .then(function(cmdobj) {
                let cmd = cmdobj;
                while (parts.length > 0 && _.has(cmd, parts[0])) {
                    let part = parts.shift();
                    cmd = _.get(cmd, part);
                    cmdpath += '.' + part;
                }
                if (!_.isFunction(cmd) && _.has(cmd, 'help')) {
                    cmd = _.get(cmd, 'help');
                }
                log.debug('Invoking command; command: %s, \nargs:', cmdpath, parts, '\noptions:\n', options);
                return _.spread(cmd)(parts);
            })
    }

    function onStop() {
        log.debug('onStop| shutting down');
        var t0 = _.now();
        setImmediate(() =>
            app.shutdown()
                .timeout(3000)
                .catch(Promise.TimeoutError, () => log.warn('onShutdownTimeout| shutdown incomplete after %s ms; forcing', _.now() - t0))
                .finally(process.exit)
                .done());
    }

    function cleanup(value, omitCallback) {
        return _.isObjectLike(value) || _.isArray()
            ? _.transform(value, (r, v, k) => _.some([
                _.isUndefined(v),
                ], Boolean) ? r : _.set(r, k, cleanup(v)))
                : value;

        return _.isPlainObject(value)
            ? _(value)
                .omit(function(value) {
                    return !value ||
                        (_.isPlainObject(value) && (_.isEmpty(value) || !_.any(value))) ||
                        (omitCallback != null && omitCallback(value));
                })
                .mapValues(_.partial(cleanup, _, omitCallback))
                .value()
            : value;
    }

    function Io(err, out) {
        if (!(this instanceof Io)) {
            return new Io(err, out);
        }

        let util = require('util');
        err = err || process.stderr;
        out = out || process.stdout;

        this.err = IoWriter(err, '\n');
        this.err.raw = IoWriter(err);
        this.out = IoWriter(out, '\n');
        this.out.raw = IoWriter(out);

        function IoWriter(stream, tail) {
            tail = tail || '';
            return function iowrite(format) {
                let args = Array.prototype.slice.call(arguments, 0);
                let text = util.format.apply(util, args) + tail;
                return new Promise((resolve, reject) =>
                    stream.write(text, error => error ? reject(error) : resolve()));
            };
        }
    }
}).done();
