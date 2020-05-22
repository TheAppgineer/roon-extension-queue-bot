// Copyright 2020 The Appgineer
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

"use strict";

const QUEUE_BOT = 'Queue Bot';
const PAUSE = 'Pause';
const STANDBY = 'Standby';

const RoonApi          = require('node-roon-api'),
      RoonApiStatus    = require('node-roon-api-status'),
      RoonApiTransport = require('node-roon-api-transport');

var core = undefined;
var transport = undefined;
var waiting_zones = {};
var monitoring_zones = {};
var zone_names;

var roon = new RoonApi({
    extension_id:        'com.theappgineer.queue-bot',
    display_name:        QUEUE_BOT,
    display_version:     '0.2.1',
    publisher:           'The Appgineer',
    email:               'theappgineer@gmail.com',
    website:             'https://community.roonlabs.com/t/roon-extension-queue-bot/104271',

    core_paired: function(core_) {
        core = core_;
        transport = core.services.RoonApiTransport;
        waiting_zones = {};
        monitoring_zones = {};

        transport.subscribe_zones((response, msg) => {
            if (response == "Subscribed") {
                msg.zones.forEach((zone) => {
                    setup_queue_bot_monitoring(zone);
                    check_for_match(zone);
                });
            } else if (response == "Changed") {
                if (msg.zones_added) {
                    msg.zones_added.forEach((zone) => {
                        setup_queue_bot_monitoring(zone);
                        check_for_match(zone);
                    });
                }

                if (msg.zones_changed) {
                    msg.zones_changed.forEach((zone) => {
                        if (Object.keys(monitoring_zones).includes(zone.zone_id)) {
                            monitoring_zones[zone.zone_id] = zone;
                            check_for_match(zone);
                        }
                    });
                }

                if (msg.zones_removed) {
                    msg.zones_removed.forEach((zone_id) => {
                        delete waiting_zones[zone_id];
                        delete monitoring_zones[zone_id];

                        update_zone_names();
                    });
                }
            }
        });
    },
    core_unpaired: function(core_) {
        core = undefined;
        transport = undefined;
    }
});

function check_for_match(zone) {
    const on_match = waiting_zones[zone.zone_id];

    if (on_match && on_match.properties) {
        const is_subset = require('is-subset');

        if (is_subset(zone, on_match.properties)) {
            delete waiting_zones[zone.zone_id];

            if (on_match.cb) {
                on_match.cb(zone);
            }
        }
    }
}

function on_zone_property_changed(zone_id, properties, cb) {
    waiting_zones[zone_id] = { properties: properties, cb: cb };
}

function setup_queue_bot_monitoring(zone) {
    const properties = {
        state: 'playing',
        now_playing: { three_line: { line2: QUEUE_BOT } }
    };

    if (!Object.keys(monitoring_zones).includes(zone.zone_id)) {
        monitoring_zones[zone.zone_id] = zone;

        console.log("Queue Bot monitoring activated for", zone.display_name);

        update_zone_names();
    }

    on_zone_property_changed(zone.zone_id, properties, (zone) => {
        const action = zone.now_playing.three_line.line1;

        svc_status.set_status(`Latest Action: ${zone.display_name} put into ${action}\n${zone_names}`, false);

        pause(zone, (zone) => {
            setup_queue_bot_monitoring(zone);

            if (action == STANDBY) {
                transport.standby(zone.outputs[0], {}, (err) => {
                    if (err) {
                        svc_status.set_status(`${zone.display_name} doesn't support ${action}`, true);
                    }
                });
            }
        });
    });
}

function update_zone_names() {
    zone_names = 'Monitoring Zones:';

    for (const zone_id in monitoring_zones) {
        zone_names += '\n\u2022 ' + monitoring_zones[zone_id].display_name;
        zone_names += supports_standby(monitoring_zones[zone_id].outputs[0]);
    }

    svc_status.set_status(zone_names, false);
}

function supports_standby(output) {
    for (let i = 0; i < output.source_controls.length; i++) {
        if (output.source_controls[i].supports_standby) {
            return ' (supports Standby)';
        }
    };

    return '';
}

function pause(zone, cb) {
    transport.control(zone, 'pause', () => {
        if (zone.is_next_allowed) {
            // Wait for state playing...
            // (there can be intermediate states, like stopped, loading)
            on_zone_property_changed(zone.zone_id, { state: 'playing' }, (zone) => {
                transport.control(zone, 'stop', () => {
                    cb && cb(zone);
                });
            });

            // ...to be triggered by next command
            transport.control(zone, 'next');
        } else {
            cb && cb(zone);
        }
    });
}

var svc_status = new RoonApiStatus(roon);

roon.init_services({
    required_services:   [ RoonApiTransport ],
    provided_services:   [ svc_status ]
});

roon.start_discovery();
