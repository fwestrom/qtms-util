module.exports = function spawner(_, child_process, io, logging, os, Promise) {
    var log = logging.getLogger('spawner');
    var children = [];
    return {
        spawn: function spawn(cwd, command, args, opts) {
            if (arguments.length === 1 && _.isPlainObject(arguments[0])) {
                opts = arguments[0];
                cwd = command = args = undefined;
            }
            opts = _(opts || {})
                .assign({
                    arguments: args || opts.args || opts.arguments || [],
                    command: command || opts.cmd || opts.command,
                    cwd: cwd || opts.cwd || opts.cd || opts.wd,
                })
                .omit(['args', 'cmd', 'cd', 'wd'])
                .value();

            //var rl = require('readline').createInterface(process.stdin, process.stdout);
            var tmpRawMode = process.stdin.isRaw || undefined;

            var child =  spawnChild(opts);
            children.push(child);
            if (children.length === 1) {
                if (_.hasIn(process, 'stdin.setRawMode')) {
                    process.stdin.setRawMode(true);
                    process.stdin.on('data', onStdinData);
                    process.stdin.on('keypress', onStdinKeypress);
                }
                process.on('SIGINT', onInterrupt);
                process.on('SIGTERM', onInterrupt);
            }
            return child.join()
                .finally(function() {
                    _.remove(children, c => c === child);
                    if (children.length === 0) {
                        if (_.hasIn(process, 'stdin.setRawMode')) {
                            process.stdin.setRawMode(tmpRawMode);
                            process.stdin.removeListener('data', onStdinData);
                            process.stdin.removeListener('keypress', onStdinData);
                        }
                        process.removeListener('SIGINT', onInterrupt);
                        process.removeListener('SIGTERM', onInterrupt);
                    }
                });

            function onStdinData(data) {
                data = data.toString();
                var interrupted = data.includes('\u0003');
                io.out.raw(data.split('\u0003').join('').split('\r').join('\n'));
                if (interrupted) {
                    onInterrupt();
                }
            }
            function onStdinKeypress(s, key) {
                log.warn('keypress| s: %s, key: %s', s, key);
            }
        },
    };

    function onInterrupt() {
        log.debug('spawn| interrupted');
        _.forEach(children, function(child) {
            child.kill('SIGINT');
        });
    }

    function spawnChild(opts) {
        var args = opts.arguments || opts.args || [];
        var command = opts.command || opts.cmd;
        var cwd = opts.cwd || opts.cd || opts.wd || opts.workdir;
        var env = _.assign(process.env, opts.environment || opts.env || {});

        var log = logging.getLogger(command);
        log.debug(command, _.join(args || '', ' '));
        var useShell = opts.useShell || false;
        if(_.includes(os.platform(), 'win')) {
            useShell = opts.useShell || true;
        }

        log.trace('spawnChild| %s %s', cwd, command, args.join(' '), '\nenv:\n', env);

        var cp = child_process.spawn(command, args || [], {
            cwd: cwd,
            env: env,
            shell: useShell,
            stdio: 'inherit',
        });

        log.trace('spawnChild| spawned child process: %s', cp.pid, '\nstdin:\n', cp.stdin, '\nstdout:\n', cp.stdout);
        //cp.stdout.on('data', (data) => { io.out.raw(data.toString()); });
        //cp.stderr.on('data', (data) => { io.err.raw(data.toString()); });

        var promise = new Promise(function(resolve, reject) {
            cp.on('error', function(error) {
                return reject(error);
            });
            cp.on('exit', function(code, signal) {
                return code !== 0 ? reject({ code: code, signal: signal }) : resolve();
            });
        });
        return _.bindAll({
            join: function() {
                return promise;
            },
            kill: function(signal) {
                cp.kill(signal || 'SIGINT');
            },
        });
    }
};
