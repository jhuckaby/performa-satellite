# Overview

This module is a companion to the [Performa](https://github.com/jhuckaby/performa) monitoring system.  It is the data collector, which can be installed on all your servers.  It collects metrics and sends them to the central Performa server every minute, and is activated by [cron](https://en.wikipedia.org/wiki/Cron).  It is shipped as a precompiled binary and thus has no dependencies.

# Installation

The easiest way to install Performa Satellite is to use one of our precompiled binaries.  It can live anywhere on the filesystem, but for these examples we place it into the `/opt/performa` directory.  Make sure you are `root` (superuser) to install this.

```
mkdir /opt/performa
curl -L https://github.com/jhuckaby/performa-satellite/releases/latest/download/performa-satellite-linux > /opt/performa/satellite.bin
chmod 755 /opt/performa/satellite.bin
/opt/performa/satellite.bin --install
```

The `linux` binary should work on any 64-bit Linux OS, including RedHat/CentOS and Debian/Ubuntu.  If you are installing on macOS, replace `linux` with `macos`.  There is also a [Windows executable](https://github.com/jhuckaby/performa-satellite/releases/download/v1.0.0/performa-satellite-win.exe) available, but it is untested (and no [cron](https://en.wikipedia.org/wiki/Cron) there to automate launching it).

Running the binary with the `--install` argument will add it to [cron](https://en.wikipedia.org/wiki/Cron), specifically in `/etc/cron.d/performa-satellite.cron`, which is set to run once per minute.  It also creates a default configuration file, if one doesn't exist.

# Configuration

Performa Satellite expects a JSON formatted configuration file to live in the same directory as the binary executable, and named `config.json`.  Here is an example file:

```json
{
	"enabled": true,
	"host": "performa.local:5511",
	"secret_key": "CHANGE_ME",
	"group": ""
}
```

Here are descriptions of the properties you can put in the file:

| Property Name | Type | Description |
|---------------|------|-------------|
| `enabled` | Boolean | This enables or disables Performa Satellite.  Set this to `false` to pause metrics collection. |
| `host` | String | Set this to the hostname and port of your Performa master server, e.g. `performa.mycompany.com:5511`.  The default port for Performa is `5511`. |
| `secret_key` | String | **(Optional)** If you plan on using [custom commands](https://github.com/jhuckaby/performa#commands), set this to the same secret key string on your Performa master server.  See [Secret Key](https://github.com/jhuckaby/performa#secret_key) for details. |
| `group` | String | **(Optional)** The group ID is optional, and only needed if you have servers with indeterminate hostnames (i.e. serverless, autoscale, etc.).  See [Groups](https://github.com/jhuckaby/performa#groups) for details. |
| `proto` | String | **(Optional)** If you have configured your Performa master server with HTTPS, Satellite can send metrics securely by setting this property to `https:`. |
| `insecure` | Boolean | **(Optional)** If you are using HTTPS but have a self-signed SSL certificate, setting this property to `true` will bypass certificate verification when making HTTPS requests. |

**Note:** If you set a `secret_key` it is highly recommended that you also set the config file owner to `root` and the permissions to `600`, so only the root user can read it.

## Command-Line Arguments

The Performa Satellite binary executable accepts the following command-line arguments:

| Argument | Description |
|----------|-------------|
| `--install` | This runs first-time installation tasks such as creating the cron job and a sample configuration file. |
| `--uninstall` | This removes the cron job and deletes the config file, if one is found. |
| `--config` | Optionally specify a custom location on disk for the configuration file. |
| `--debug` | Setting this flag runs the collector in debug mode, causing it to emit raw stats on the console rather than submitting them to the server. |
| `--nosleep` | This disables the random sleep that Satellite performs before collecting and sending metrics. |
| `--hostname` | This allows you to specify a custom local hostname, to use in place of the actual server hostname. |
| `--fake` | Setting this flag will generate "fake" (semi-random) metrics data.  Used for testing purposes. |
| `--quiet` | This silences all output from Satellite, even fatal errors. |

# Scalability

Performa Satellite is designed to run on many servers, and will randomly delay sending metrics by up to 6 seconds, so not all your servers contact the central master server at the same instant.  The same random seed is used for each server (it is based on the hostname) to insure that the metrics collection happens exactly 1 minute apart.

You can disable the sleep feature by setting the `--nosleep` command-line argument.

# Development

You can install the Performa Satellite source code by using [Git](https://en.wikipedia.org/wiki/Git) ([Node.js](https://nodejs.org/) is also required):

```
git clone https://github.com/jhuckaby/performa-satellite.git
cd performa-satellite
npm install
```

You can then run it in debug mode by issuing this command:

```
node index.js --debug
```

To repackage the binary executables for Linux, macOS and Windows, run this command:

```
npm run package
```

# License (MIT)

**The MIT License**

*Copyright (c) 2019 - 2021 Joseph Huckaby.*

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
