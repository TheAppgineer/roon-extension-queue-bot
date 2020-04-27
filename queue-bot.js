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

const RoonApi          = require('node-roon-api'),
      RoonApiStatus    = require('node-roon-api-status'),
      RoonApiTransport = require('node-roon-api-transport');

var core = undefined;
var transport = undefined;
var waiting_zones = {};
var zone_names = {};

var roon = new RoonApi({
    extension_id:        'com.theappgineer.queue-bot',
    display_name:        QUEUE_BOT,
    display_version:     '0.1.0',
    publisher:           'The Appgineer',
    email:               'theappgineer@gmail.com',
    //website:             'https://community.roonlabs.com/t/roon-extension-queue-bot/???',

    core_paired: function(core_) {
        core = core_;
        transport = core.services.RoonApiTransport;

        transport.subscribe_zones((response, msg) => {
            let zones = [];

            if (response == "Subscribed") {
                zones = msg.zones;

                zones.forEach((zone) => {
                    setup_queue_bot_monitoring(zone);
                });
            } else if (response == "Changed") {
                if (msg.zones_added) {
                    zones = msg.zones_added;

                    zones.forEach((zone) => {
                        setup_queue_bot_monitoring(zone);
                    });
                }

                if (msg.zones_changed) {
                    zones = msg.zones_changed;
                }
            }

            if (zones) {
                zones.forEach((zone) => {
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
                });
            }
        });
    },
    core_unpaired: function(core_) {
        core = undefined;
        transport = undefined;
    }
});

function on_zone_property_changed(zone_id, properties, cb) {
    waiting_zones[zone_id] = { properties: properties, cb: cb };
}

function setup_queue_bot_monitoring(zone) {
    const properties = {
        state: 'playing',
        now_playing: { three_line: { line2: QUEUE_BOT } }
    };

    console.log("Queue Bot monitoring activated for", zone.display_name);
    zone_names[zone.display_name] = undefined;
    svc_status.set_status('Monitoring Zones:\n' + Object.keys(zone_names).join('\n'), false);

    on_zone_property_changed(zone.zone_id, properties, (zone) => {
        const action = zone.now_playing.three_line.line1;

        console.log(`Action ${action} requested from zone ${zone.display_name}`);

        switch (action) {
            case PAUSE:
                transport.control(zone, 'pause', () => {
                    if (zone.is_next_allowed) {
                        transport.control(zone, 'next', () => {
                            transport.control(zone, 'stop', () => {
                                setup_queue_bot_monitoring(zone);
                            });
                        });
                    } else {
                        transport.control(zone, 'stop', () => {
                            setup_queue_bot_monitoring(zone);
                        });
                    }
                });
                break;
        }
    });
}

var svc_status = new RoonApiStatus(roon);

roon.init_services({
    required_services:   [ RoonApiTransport ],
    provided_services:   [ svc_status ]
});

roon.start_discovery();
