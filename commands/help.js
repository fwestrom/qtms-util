module.exports = function helpFactory(_, fs, inject, io, microservices, options, path, Promise, util) {
    function help(detail) {
        return function() {
            if (detail) {
                return inject(detail);
            }

            return Promise
                .try(getdescriptor)
                .tap(usage);

            function getdescriptor() {
                var cmddir = path.join(path.dirname(module.filename));
                var files = _(fs.readdirSync(cmddir))
                    .filter(file => /\.js$/i.test(file))
                    .reject(function(file) {
                        return fs.statSync(path.join(cmddir, file)).isDirectory();
                    })
                    .value();
                return Promise.reduce(files, function(result, file) {
                    var modname = path.basename(file, '.js');
                    var commands = {};
                    return inject(require(path.join(cmddir, file)))
                        .tap(function(mod) {
                            modname = mod.name || modname;
                            var pending = [{ obj: mod }];
                            while (pending.length > 0) {
                                var d = pending.pop();
                                if (_.isString(d.obj)) {
                                    continue;
                                }
                                if (_.isFunction(d.obj)) {
                                    commands[modname + ' ' + (d.name ? d.name + ' ' : '')] = d.obj;
                                }
                                _.forOwn(d.obj, function(v, k) {
                                    pending.push({ name: _.compact([d.name].concat(k.split('.'))).join(' '), obj: v });
                                });
                            }
                            result[modname] = commands;
                        })
                        .return(result);
                }, {});
            }

            function usage(descriptor) {
                var o = io.err.bind(io);
                o('Usage: %s command [options]', path.basename(process.argv[1]));
                o('');
                o('  commands:');
                _.forEach(descriptor, function(commands, mod) {
                    _.forEach(commands, function(command, name) {
                        o('    %s', name);
                    });
                });
            }
        };
    }

    return _.extend(help(), {
    });
};
