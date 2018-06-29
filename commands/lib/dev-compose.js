module.exports = function compose(getServices, _, io, logging, options, path, spawner) {
    return _.assign(
        () =>  io.out('Please specify a compose command.'),
        _.transform([
            'build', 'config', 'create', 'down', 'events', 'exec', 'help', 'kill',
            'logs','pause', 'port', 'ps', 'pull', 'restart', 'rm', 'run', 'scale',
            'start','stop', 'unpause', 'up',
        ], (compose, command) => compose[command] = function() {
            var args = [
                '-f',
                path.relative(options.projectdir, path.join(options.builddir, options.composefile)),
                '-p',
                _.isString(options.project) ? options.project : 'qs',
                command
            ];
            return spawner.spawn(options.projectdir, 'docker-compose', args.concat(_.toArray(arguments)));
        }, {}));
};
