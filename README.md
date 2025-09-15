# Slekto Backend API

This is the backend server for the Slekto application, providing a proxy to the ColorlightCloud API for managing terminals and retrieving GPS data.

## Getting Started

### Prerequisites

- Node.js
- npm

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/aifares/slektoBackend.git
    ```
2.  Navigate to the project directory:
    ```bash
    cd slektoBackend
    ```
3.  Install the dependencies:
    ```bash
    npm install
    ```

### Running the Application

To start the server, run:

```bash
npm start
```

The server will start on `http://localhost:3000`.

---

## API Documentation

### Terminal Endpoints

All terminal endpoints are available under the `/terminals` route.

---

#### Get Terminal Information

Fetches information for the default terminal.

- **Method:** `GET`
- **Endpoint:** `/terminals`
- **cURL Example:**
  ```bash
  curl http://localhost:3000/terminals
  ```
- **Success Response:**
  ```json
  [
    {
      "date": "2025-07-31T00:00:00",
      "executingTasks": [],
      "author": 4403,
      "wifiAp": false,
      "title": {
        "rendered": "Terminal1 ",
        "raw": "Terminal1 "
      },
      "type": "led",
      "comment_status": "open",
      "onBoardingStatus": 1,
      "terminalgroup": [
        {
          "name": "Ali Fares",
          "id": 6640
        }
      ],
      "cropConfig": {},
      "extra": {
        "author_display_name": "HXTECHLED"
      },
      "createdTime": "",
      "post_meta": {
        "_led_latest_screenshot_time": 1754760187,
        "update_status": {},
        "lng": 10000,
        "geo_coordinate": {},
        "download_status": {
          "download_status_time": 1754759328,
          "programs": [
            {
              "name": "Playlist5170",
              "files": [
                {
                  "total": 42286,
                  "name": "F_F4E06856BA2F3241FC1013279874DE60_42286.png",
                  "downloaded": 42286,
                  "programId": 2373637
                },
                {
                  "total": 1415,
                  "name": "Playlist5170_9ec854641cd6d569a85e6457dd308c22_1415.vsn",
                  "downloaded": 1415,
                  "programId": 2373637
                }
              ],
              "id": 2373637
            },
            {
              "name": "Playlist9140",
              "files": [
                {
                  "total": 42286,
                  "name": "F_F4E06856BA2F3241FC1013279874DE60_42286.png",
                  "downloaded": 42286,
                  "programId": 2373502
                },
                {
                  "total": 4791668,
                  "name": "F_AA9D21D9A22033FBD79EC40D0722E3C5_4791668.jpg",
                  "downloaded": 4791668,
                  "programId": 2373502
                },
                {
                  "total": 2596,
                  "name": "Playlist9140_b0aea9dd7711da82539ffd690d895ebd_2596.vsn",
                  "downloaded": 2596,
                  "programId": 2373502
                }
              ],
              "id": 2373502
            }
          ]
        },
        "_led_status": {
          "WebSocketStatus": {
            "status": "1"
          },
          "inboundfirewall": {
            "status": "off"
          },
          "cameraconfig": {
            "msg": "200 success",
            "code": 200,
            "data": {
              "auto_upload": 0,
              "exposure": 9,
              "size": "640x480",
              "interval": 300,
              "whitebalance": "auto",
              "quality": 100
            }
          },
          "http_verification": {
            "msg": "200 success",
            "code": 200,
            "data": {
              "http_ftp_verification": "1",
              "http_ftp_weak_password": false
            }
          },
          "brightnessandcolortemp": {
            "brightness": 10,
            "_report_time": 1754759328,
            "colortemperature": 9800
          },
          "x16_preset": {},
          "locale": {
            "country": "US",
            "language": "en"
          },
          "cmdinterval": {
            "command_interval": 5000
          },
          "reportswitch": {
            "complete_screen_status_report": "on",
            "rotate_program_screenshot_report": "off",
            "log_report": "off",
            "not_rotate_program_screenshot_report": "on",
            "auto_info_report": "on",
            "manual_info_report": "on",
            "manual_vsns_report": "on",
            "command_screenshot_report": "on",
            "auto_vsns_report": "on",
            "rotate_program_vsns_report": "on"
          },
          "screen_orientation": {
            "orientation": "2"
          },
          "powerstatus": {
            "_report_time": 1754759322,
            "powerstatus": 1
          },
          "dimension": {
            "dclk": 500000000,
            "_report_time": 1754759322,
            "real_width": 160,
            "fps": 60,
            "width": 160,
            "hsync": 8,
            "real_dclk": 50000000,
            "real_height": 120,
            "height": 120
          },
          "info": {
            "_report_time": 1754759322,
            "info": {
              "mem": {
                "total": 463646720,
                "free": 223715328
              },
              "model": "a20",
              "playing": {
                "path": "/mnt/sdcard/Android/data/com.color.home/files/Download",
                "name": "Playlist5170_9ec854641cd6d569a85e6457dd308c22_1415.vsn",
                "source": "internet"
              },
              "up": 70083,
              "storage": {
                "total": 4487905280,
                "free": 4297043968
              },
              "vername": "1.80.8",
              "serialno": "CLCA20003400"
            }
          },
          "rtc": {
            "_report_time": 1754759322,
            "timezone": "+08",
            "isautotimezone": 1,
            "time": "2025-08-09 13:08:41",
            "isautotime": 1
          },
          "board_relay": [
            {
              "delay": 0,
              "relay": 1,
              "status": 0
            }
          ],
          "inputmode": {
            "_report_time": 1754759328
          },
          "allbrightnessinfo": {
            "sensorBright": -2,
            "webSource": 0,
            "savedBrightValue": 10,
            "sensorSource485": 0,
            "isHasSensor": false,
            "briAndClrTAdjustType": 1,
            "sensorSourceMultifunctionCard": 0,
            "realTimeBrightValue": 10,
            "isbShowOn": true
          },
          "terminal": {
            "_report_time": 1754759322,
            "name": ":Terminal1 ",
            "leddescription": "deviceNo=Terminal3400&productionDate=2025-07-31 00:00:00"
          },
          "ifstatus": {
            "types": [
              {
                "connected": 1,
                "carrier": 1,
                "weakPassword": false,
                "pass": "*",
                "peers": [],
                "operstate": "up",
                "type": "wifi ap",
                "ips": {
                  "broadcast": "192.168.43.255",
                  "ip": "192.168.43.1",
                  "mask": "255.255.255.0"
                },
                "SSID": "AP-20003400",
                "enabled": 1,
                "mac": "42:91:51:67:01:6a",
                "speed": -1
              },
              {
                "connected": 0,
                "mode": "static",
                "carrier": 0,
                "ssids": [],
                "operstate": "down",
                "state": "UNINITIALIZED",
                "type": "wifi",
                "enabled": 0,
                "mac": "40:91:51:67:01:6a",
                "speed": -1
              },
              {
                "connected": 0,
                "mode": "dhcp",
                "carrier": 0,
                "operstate": "down",
                "type": "lan",
                "ips": {
                  "dns2": "0.0.0.0",
                  "ip": "0.0.0.0",
                  "dns1": "0.0.0.0",
                  "gateway": "0.0.0.0",
                  "mask": "0.0.0.0"
                },
                "enabled": 0,
                "mac": "d2:c5:ac:14:aa:6b",
                "speed": -1
              },
              {
                "connected": 1,
                "mode": "LTE",
                "carrier": 0,
                "strength": 2,
                "type": "4G",
                "enabled": 1,
                "speed": -1
              }
            ]
          },
          "reporttime": {
            "sensor_report_interval": 0,
            "ber_report_interval": 0,
            "gps_report_interval": 0
          },
          "sync_program_mode": {
            "sync_program_ntp_server": "ntp7.aliyun.com",
            "sync_program_lan_enable": 0,
            "sync_program_ntp_threshold": 5,
            "sync_program_ntp_interval": 20000,
            "sync_program_ntp_enable": 1,
            "sync_program_gps_enable": 0,
            "sync_program_lan_role": "slave",
            "sync_program_audio_enable": 0
          },
          "brightnessversion": {
            "isNewBrightness": 1
          },
          "volume": {
            "musicvolume": 0,
            "_report_time": 1754759328
          },
          "contentreport": {
            "content_report_status": 1
          },
          "vsns": {
            "_report_time": 1754760186,
            "contents": [
              {
                "unused": 0,
                "ressize": 0,
                "type": "lan",
                "content": [
                  {
                    "size": 6381334,
                    "name": "160×120.vsn",
                    "publishedmd5": "",
                    "md5": ""
                  }
                ]
              },
              {
                "unused": 0,
                "ressize": 4833954,
                "type": "internet",
                "content": [
                  {
                    "size": 43701,
                    "name": "Playlist5170_9ec854641cd6d569a85e6457dd308c22_1415.vsn",
                    "publishedmd5": "",
                    "md5": ""
                  },
                  {
                    "size": 4836550,
                    "name": "Playlist9140_b0aea9dd7711da82539ffd690d895ebd_2596.vsn",
                    "publishedmd5": "",
                    "md5": ""
                  }
                ]
              }
            ],
            "playing": {
              "name": "Playlist9140_b0aea9dd7711da82539ffd690d895ebd_2596.vsn",
              "type": "internet"
            }
          },
          "x16_brightness": {},
          "4ginfo": {
            "msg": "200 success",
            "code": 200,
            "data": {
              "linenumber": "19296812659",
              "simoperatorname": "",
              "simserial": "8901260418788048411",
              "hasicc": "true",
              "imsi": "310260418804841",
              "networktype": "LTE",
              "deviceid": "864839042567996",
              "operator": "310260",
              "phonetype": "NO_PHONE",
              "simoperator": "310260",
              "dataactivity": "NONE",
              "datastate": "CONNECTED",
              "simstate": "READY",
              "msisdn": "19296812659",
              "operatorname": "T-Mobile"
            }
          },
          "brightcurve": {
            "maxPercent": 85,
            "midAdjustValue": 45,
            "maxOriginalValue": 1,
            "minOriginalValue": 0,
            "auto": 0,
            "isNewBrightness": 1,
            "sensorSource485": 0,
            "method": 0,
            "noneReverseGammaValues": [],
            "save": 0,
            "minPercent": 0,
            "reverseGammaValues": [],
            "sensorSourceMultifunctionCard": 0,
            "expiredTime": 0,
            "midPercent": 55,
            "webSource": 0,
            "sensorErrorDefaultValue": 64,
            "minAdjustValue": 0,
            "sensitivity": 0,
            "maxAdjustValue": 98,
            "sensorSourceM2": 0
          },
          "contentreportinterval": {
            "content_report_interval": 0,
            "content_report_size": 0
          },
          "newrtc": {
            "_report_time": 1754759322,
            "timezone": -5,
            "timezoneId": "America/New_York",
            "time": "2025-08-09 13:08:41",
            "isautotime": 1
          }
        },
        "geo_longitude": "",
        "_led_latest_report_time": 1754763447,
        "lat": 10000
      },
      "sn": "",
      "id": 2355209,
      "excerpt": {
        "rendered": "Terminal3400",
        "raw": "Terminal3400"
      },
      "date_gmt": "2025-07-31T08:34:14Z",
      "slug": "",
      "status": "publish"
    }
  ]
  ```

---

#### Register Terminal

Registers a new terminal with the service.

- **Method:** `POST`
- **Endpoint:** `/terminals/register`
- **cURL Example:**
  ```bash
  curl -X POST http://localhost:3000/terminals/register \
  -H "Content-Type: application/json" \
  -d '{"sn": "CLCA20003401", "name": "New Terminal"}'
  ```
- **Request Body:**
  ```json
  {
    "sn": "CLCA20003401",
    "name": "New Terminal"
  }
  ```
- **Success Response:**
  ```json
  {
    "message": "Terminal registered",
    "data": { ... }
  }
  ```

---

#### Put Terminal to Sleep

Sends a command to put the default terminal to sleep.

- **Method:** `POST`
- **Endpoint:** `/terminals/sleep`
- **cURL Example:**
  ```bash
  curl -X POST http://localhost:3000/terminals/sleep
  ```
- **Success Response:**
  ```json
  {
    "message": "Terminal put to sleep",
    "data": { ... }
  }
  ```

---

#### Wake Terminal Up

Sends a command to wake the default terminal up.

- **Method:** `POST`
- **Endpoint:** `/terminals/wake`
- **cURL Example:**
  ```bash
  curl -X POST http://localhost:3000/terminals/wake
  ```
- **Success Response:**
  ```json
  {
    "message": "Terminal woken up",
    "data": { ... }
  }
  ```

---

#### Set Terminal Brightness

Sets the brightness for the default terminal.

- **Method:** `POST`
- **Endpoint:** `/terminals/brightness`
- **cURL Example:**
  ```bash
  curl -X POST http://localhost:3000/terminals/brightness \
  -H "Content-Type: application/json" \
  -d '{"brightness": 50}'
  ```
- **Request Body:**
  ```json
  {
    "brightness": 50
  }
  ```
- **Success Response:**
  ```json
  {
    "message": "Brightness set to 50",
    "data": { ... }
  }
  ```

---

### GPS Endpoints

All GPS endpoints are available under the `/gps` route.

---

#### Get Current GPS Information

Fetches the current GPS information for the default terminal.

- **Method:** `GET`
- **Endpoint:** `/gps/current`
- **cURL Example:**
  ```bash
  curl http://localhost:3000/gps/current
  ```
- **Success Response:**
  ```json
  {
    "gps": {
      "terminalId": 855,
      "terminalName": "gps test 111",
      "reportTime": "2024-06-28T11:17:32",
      "serverTime": "2024-06-28T03:17:53.832",
      "clientTime": "2024-06-28T11:17:53.832",
      "sensorId": 20,
      "longitude": 113.94309131666667,
      "latitude": 22.577762733333334,
      "accuracy": 1.6,
      "altitude": 183.7,
      "speed": 0,
      "direct": 154.9,
      "satellites": 6,
      "cellInfo": null,
      "gsv": null,
      "manual": null,
      "latestReportTime": "2024-06-28T11:17:53.832"
    }
  }
  ```

---

#### Get GPS Track

Fetches the GPS trajectory for the default terminal within a specified time range.

- **Method:** `POST`
- **Endpoint:** `/gps/track`
- **cURL Example:**
  ```bash
  curl -X POST http://localhost:3000/gps/track \
  -H "Content-Type: application/json" \
  -d '{"startTime": "2024-06-28T00:00:00", "endTime": "2024-06-28T23:59:59"}'
  ```
- **Request Body:**
  ```json
  {
    "startTime": "2024-06-28T00:00:00",
    "endTime": "2024-06-28T23:59:59"
  }
  ```
- **Success Response:**
  ```json
  {
    "terminalId": 855,
    "terminalName": "gps test 111",
    "startTime": "2024-06-28T00:00:00",
    "endTime": "2024-06-28T23:59:59",
    "data": [
      {
        "longitude": 113.94305323333333,
        "latitude": 22.577767916666666,
        "serverTime": "2024-06-28T02:52:50.38",
        "clientTime": "2024-06-28T10:52:50.38"
      }
    ]
  }
  ```

---

### Content Endpoints

All content endpoints are available under the `/content` route.

---

#### Get All Programs

Fetches all programs for the default terminal.

- **Method:** `GET`
- **Endpoint:** `/content/programs`
- **cURL Example:**
  ```bash
  curl http://localhost:3000/content/programs
  ```
- **Success Response:**
  ```json
  [
      {
          "id": 2373637,
          "title": {
              "rendered": "Playlist5170"
          },
          ...
      }
  ]
  ```

---

#### Publish a Program

Publishes a program to the default terminal by its playlist name.

- **Method:** `POST`
- **Endpoint:** `/content/publish`
- **cURL Example:**
  ```bash
  curl -X POST http://localhost:3000/content/publish \
  -H "Content-Type: application/json" \
  -d '{"playlistName": "Playlist5170"}'
  ```
- **Request Body:**
  ```json
  {
    "playlistName": "Playlist5170"
  }
  ```
- **Success Response:**
  ```json
  {
    "message": "Program activated",
    "data": { ... }
  }
  ```
