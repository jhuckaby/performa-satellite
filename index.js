#!/usr/bin/env node

// Performa Satellite
// Gathers metrics and submits them to a Performa master server
// Install via crontab to run every minute
// See: https://github.com/jhuckaby/performa-satellite
// Copyright (c) 2019 Joseph Huckaby, MIT License

var fs = require('fs');
var os = require('os');
var cp = require('child_process');
var Path = require('path');
var XML = require('pixl-xml');
var Request = require('pixl-request');
var cli = require('pixl-cli');
var si = require('systeminformation');

var request = new Request("Performa-Satellite/1.0");
request.setTimeout( 3 * 1000 ); // 3 seconds
request.setAutoError( true );
request.setRetries( 3 );
request.setKeepAlive( true );

cli.global();
var Tools = cli.Tools;
var args = cli.args;
var async = Tools.async;
var self_bin = Path.resolve( process.argv[0] );
var config_file = Path.join( Path.dirname( self_bin ), 'config.json' );
var config = {};

if (args.install || (args.other && (args.other[0] == 'install'))) {
	// first time installation, add self to crontab
	var raw_tab = "";
	raw_tab += "# Run Performa Satellite data collector once per minute.\n";
	raw_tab += "# See: https://github.com/jhuckaby/performa-satellite\n";
	raw_tab += '* * * * * root ' + self_bin + "\n";
	
	var cron_file = '/etc/cron.d/performa-satellite.cron';
	fs.writeFileSync( cron_file, raw_tab, { mode: 0o744 } );
	fs.utimesSync( '/etc/crontab', new Date(), new Date() );
	print("\nPerforma Satellite has been installed to cron:\n\t" + cron_file + "\n");
	
	if (!fs.existsSync(config_file)) {
		config = { enabled: true, host: "performa.local:5511", secret_key: "CHANGE_ME", group: "" };
		var raw_config = JSON.stringify( config, null, "\t" );
		fs.writeFileSync( config_file, raw_config, { mode: 0o600 } );
		print("\nA sample config file has been created: " + config_file + ":\n");
		print( raw_config + "\n" );
	}
	
	print("\n");
	process.exit(0);
}

// optional config file, in same dir as executable or custom location
if (args.config && fs.existsSync(args.config)) {
	config = JSON.parse( fs.readFileSync(args.config, 'utf8') );
}
else if (fs.existsSync(config_file)) {
	config = JSON.parse( fs.readFileSync(config_file, 'utf8') );
}
else if (fs.existsSync( Path.join(__dirname, 'config.json') )) {
	config = JSON.parse( fs.readFileSync(Path.join(__dirname, 'config.json'), 'utf8') );
}

// exit quietly if not enabled
if (!config.enabled && !args.enabled && !process.env['PERFORMA_ENABLED']) process.exit(0);

// optionally switch users
if (!args.debug && config.uid && (process.getuid() == 0)) {
	var user = Tools.getpwnam( config.uid );
	if (user) process.setuid( user.uid );
}

// determine hostname to submit metrics to
var api_host = args.host || process.env['PERFORMA_HOST'] || config.host || 'performa.local:5511';
var api_proto = args.proto || process.env['PERFORMA_PROTO'] || config.proto || 'http:';

if (args.insecure || process.env['PERFORMA_INSECURE'] || config.insecure) {
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

// allow server to specify its own group (i.e. for auto-scaling)
var group_id = args.group || process.env['PERFORMA_GROUP'] || config.group || '';

// start building JSON structure
var info = {
	version: "1.0",
	date: (new Date()).getTime() / 1000,
	hostname: args.hostname || os.hostname(),
	data: {
		uptime_sec: os.uptime(),
		arch: os.arch(),
		platform: os.platform(),
		release: os.release(),
		load: os.loadavg(),
		// cpus: os.cpus(),
		stats: {}
	}
};
if (group_id) info.group = group_id;

var commands = [];
var host_hash = Tools.digestHex( info.hostname, 'md5' );
var host_id = parseInt( host_hash.substring(0, 16), 16 ); // 64-bit numerical hash

async.series([
	function(callback) {
		// sleep for N seconds based on hash of hostname
		// this is to avoid multiple servers from submitting metrics at the same instant
		if (args.debug || args.nosleep) return process.nextTick(callback);
		
		var sleep_ms = 1000 + (host_id % 5000);
		setTimeout( function() { callback(); }, sleep_ms );
	},
	function(callback) {
		// first call home to say hello and gs list of custom commands to run, if any
		if (!config.secret_key) return process.nextTick( callback );
		
		var url = api_proto + "//" + api_host + "/api/app/hello";
		var nonce = Tools.generateUniqueID();
		var auth = Tools.digestHex(nonce + config.secret_key, 'sha256');
		
		var hello = {
			version: info.version, 
			hostname: info.hostname, 
			group: info.group || '',
			nonce: nonce
		};
		
		request.json( url, hello, function(err, resp, data, perf) {
			// check for error, fatal unless in debug mode
			var err_msg = '';
			if (err) err_msg = "Performa Satellite Error: Failed to call home: " + err;
			else if (data.code) err_msg = "Performa Satellite Error: API returned: " + data.description;
			if (err_msg) {
				if (args.debug) warn( "Warning: " + err_msg + "\n" );
				else die( err_msg + "\n" );
			}
			
			// validate nonce and auth
			if (data.nonce !== nonce) {
				// should never happen, generate deliberately vague error message
				die("Performa Satellite Error: Authentication failure\n");
			}
			if (data.auth !== auth) {
				die("Performa Satellite Error: Authentication failure (secret keys do not match)\n");
			}
			
			commands = data.commands || [];
			callback();
		});
	},
	function(callback) {
		// operating system
		si.osInfo( function(data) {
			data.platform = Tools.ucfirst( data.platform );
			info.data.os = data;
			callback();
		} );
	},
	function(callback) {
		// system memory
		si.mem( function(data) {
			info.data.memory = data;
			callback();
		} );
	},
	function(callback) {
		// cpu info
		si.cpu( function(data) {
			info.data.cpu = data;
			callback();
		} );
	},
	function(callback) {
		// cpu load
		si.currentLoad( function(data) {
			Tools.mergeHashInto( info.data.cpu, data );
			callback();
		} );
	},
	function(callback) {
		// file systems
		si.fsSize( function(data) {
			info.data.mounts = data;
			callback();
		} );
	},
	/*function(callback) {
		// block devices
		si.blockDevices( function(data) {
			info.data.devices = data;
			callback();
		} );
	},*/
	function(callback) {
		// disk IO
		si.disksIO( function(data) {
			info.data.stats.io = data;
			callback();
		} );
	},
	function(callback) {
		// filesystem stats
		si.fsStats( function(data) {
			info.data.stats.fs = data;
			callback();
		} );
	},
	/*function(callback) {
		// network interfaces
		si.networkInterfaces( function(data) {
			info.data.interfaces = data;
			callback();
		} );
	},*/
	function(callback) {
		// network stats (first external interface)
		si.networkStats( function(data) {
			info.data.stats.network = data[0];
			callback();
		} );
	},
	function(callback) {
		// count open network sockets
		si.networkConnections( function(data) {
			info.data.stats.network.conns = data ? data.length : 0;
			callback();
		} );
	},
	function(callback) {
		// all processes
		si.processes( function(data) {
			info.data.processes = data;
			delete info.data.processes.list;
			callback();
		} );
	},
	function(callback) {
		// custom commands
		if (!commands.length) return process.nextTick( callback );
		info.data.commands = {};
		
		async.eachSeries( commands,
			function(command, callback) {
				// exec single command
				if (!command.timeout) command.timeout = 5; // default 5 sec
				var child_opts = { 
					timeout: command.timeout * 1000,
					windowsHide: true,
					env: Tools.copyHash( process.env )
				};
				if (command.uid != 0) {
					var user_info = Tools.getpwnam( command.uid, true );
					if (user_info) {
						child_opts.uid = parseInt( user_info.uid );
						child_opts.gid = parseInt( user_info.gid );
						child_opts.env.USER = child_opts.env.USERNAME = user_info.username;
						child_opts.env.HOME = user_info.dir;
						child_opts.env.SHELL = user_info.shell;
					}
					else {
						info.data.commands[ command.id ] = "Error: Could not determine user information for: " + command.uid;
						return process.nextTick( callback );
					}
				}
				
				cp.exec( command.exec, child_opts, function(err, stdout, stderr) {
					var result = '';
					if (err) result = '' + err;
					else result = '' + stdout;
					
					// automatically parse JSON or XML
					if ((command.format == 'json') && result.match(/(\{|\[)/)) {
						// attempt to parse JSON
						var json = null;
						try { json = JSON.parse(result); }
						catch (err) { result = 'JSON Parser Error: ' + err; }
						if (json) result = json;
					}
					else if ((command.format == 'xml') && result.match(/\</)) {
						// attempt to parse XML
						var xml = null;
						try { xml = XML.parse(result); }
						catch (err) { result = "XML Parser Error: " + err; }
						if (xml) result = xml;
					}
					else {
						// plain text, trim whitespace
						result = result.trim();
					}
					
					info.data.commands[ command.id ] = result;
					callback();
				}); // exec
			},
			callback
		);
	},
	function(callback) {
		// all done
		
		if (args.fake) {
			// fake up metrics based on host ID hash and timestamp
			// used for testing purposes
			var data_paths = [
				'load/0',
				'memory/used',
				'memory/available',
				'stats/network/conns',
				'mounts/0/use',
				'stats/fs/rx',
				'stats/fs/wx',
				'stats/io/tIO',
				'commands/open_files',
				'stats/network/rx_bytes',
				'stats/network/tx_bytes',
				'processes/all'
			];
			data_paths.forEach( function(path) {
				var now = Tools.timeNow(true);
				var id1 = parseInt( host_hash.substring(0, 16), 16 );
				var id2 = parseInt( host_hash.substring(16), 16 );
				var cycle_len = (id1 % 90) + 10; // between 10 and 99 minutes
				var cycle_half = Math.floor( cycle_len / 2 );
				var cycle_idx = Math.floor(now / 60) % cycle_len;
				var adj1 = ((id1 % 10000) / 10000) + 0.5; // 0.5 to 1.5
				var adj2 = ((id2 % 10000) / 10000) + 0.5; // 0.5 to 1.5
				var orig_value = Tools.getPath( info.data, path ) || 0;
				var value1 = orig_value * adj1;
				var value2 = orig_value * adj2;
				var value = 0;
				var mode = 'EaseInOut';
				var algo = 'Quadratic';
				
				if (cycle_idx <= cycle_half) {
					value = Tools.tween( value1, value2, cycle_idx / cycle_half, mode, algo );
				}
				else {
					value = Tools.tween( value2, value1, (cycle_idx - cycle_half) / cycle_half, mode, algo );
				}
				if (orig_value == Math.floor(orig_value)) value = Math.floor(value);
				else value = Tools.shortFloat( value );
				
				Tools.setPath( info.data, path, value );
				
				// rehash md5 for next item
				host_hash = Tools.digestHex( host_hash, 'md5' );
			});
		} // fake
		
		if (args.debug) {
			print( JSON.stringify(info, null, "\t") + "\n" );
			process.exit(0);
		}
		
		// submit metrics via JSON HTTP POST
		var url = api_proto + "//" + api_host + "/api/app/submit";
		request.json( url, info, function(err, resp, data, perf) {
			if (err) die("Performa Satellite Error: Failed to submit data: " + err + "\n");
			callback();
		});
	}
]);