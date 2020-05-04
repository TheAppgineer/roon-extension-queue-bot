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
var monitoring_zones = {};

var roon = new RoonApi({
    extension_id:        'com.theappgineer.queue-bot',
    display_name:        QUEUE_BOT,
    display_version:     '0.1.1',
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
                    msg.zones_removed.forEach((zone) => {
                        delete waiting_zones[zone.zone_id];
                        delete monitoring_zones[zone.zone_id];
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
        let zone_names = 'Monitoring Zones:';

        monitoring_zones[zone.zone_id] = zone;

        for (const zone_id in monitoring_zones) {
            zone_names += '\n' + monitoring_zones[zone_id].display_name;
        }
        svc_status.set_status(zone_names, false);

        console.log("Queue Bot monitoring activated for", zone.display_name);
    }

    on_zone_property_changed(zone.zone_id, properties, (zone) => {
        const action = zone.now_playing.three_line.line1;

        console.log(`Action ${action} requested from zone ${zone.display_name}`);

        switch (action) {
            case PAUSE:
                transport.control(zone, 'pause', () => {
                    if (zone.is_next_allowed) {
                        monitoring_zones[zone.zone_id] = undefined;     // We need fresh zone data

                        transport.control(zone, 'next', () => {
                            if (monitoring_zones[zone.zone_id]) {
                                // Zone data already refreshed
                                get_into_stopped_state(monitoring_zones[zone.zone_id]);
                            } else {
                                // Wait for zone data refresh
                                on_zone_property_changed(zone.zone_id, { zone_id: zone.zone_id }, (zone) => {
                                    get_into_stopped_state(zone);
                                });
                            }
                        });
                    } else {
                        setup_queue_bot_monitoring(zone);
                    }
                });
                break;
        }
    });
}

function get_into_stopped_state(zone) {
    // Some Roon Ready device are in "stopped" state by now (e.g. AURALiC ARIES_G2)
    // While others start playback again (e.g. PS Audio Directstream DAC)
    // But then; sending stop while "stopped" starts playback on the AURALiC ARIES_G2
    // So; check state before sending stop command
    if (zone.state != 'stopped') {
        transport.control(zone, 'stop', () => {
            setup_queue_bot_monitoring(zone);
        });
    } else {
        setup_queue_bot_monitoring(zone);
    }
}

var svc_status = new RoonApiStatus(roon);

roon.init_services({
    required_services:   [ RoonApiTransport ],
    provided_services:   [ svc_status ]
});

roon.start_discovery();
