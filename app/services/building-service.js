var express = require('express');
var Promise = require('bluebird');
var logger = require('tracer').console();
var moment = require('moment');
var queryService = require('./db/query-service');

var buildingService = (function() {
  return {
    getNearbyBuildings: function(payLoad) {
      /*
      Returns all nearby buildings within this proximity
      */
      
      var proximity = 0.0010

      var latUp = parseFloat(payLoad.lat) + proximity;
      var latDown = parseFloat(payLoad.lat) - proximity;
      var lonLeft = parseFloat(payLoad.lon) - proximity;
      var lonRight = parseFloat(payLoad.lon) + proximity;

      logger.log(payLoad)
      logger.log(latUp, latDown, lonLeft, lonRight)
      return queryService.selectNearby('buildings', '', [latDown, latUp, lonRight, lonLeft])
      .then(undefined, function(err){
        throw new MyError(err.message, __line, 'building-service.js');
      })
    },
    getAllBuildings: function(payLoad) {
      /*
      Returns all buildings
      */
      return queryService.selectAll('buildings', 'name')
      .then(undefined, function(err){
        logger.log("Throwing an error");
        throw new MyError(err.message, __line, 'building-service.js');
      })
    },

    getBuildingInfo: function(payLoad) {
      /*
      Return {Available/Available Soon/Unavailable: room_id, code}, comments, bookings, hours
      Unavailable - booked right now and not free soon
      Available soon - booked right now but free soon
      Available - not booked
      */
      logger.log(payLoad)
      var hours = null
      var comments = null
      var rooms = null;

      var day = moment().format('dddd')
      var time = moment().format('HH:mm')
      var splitTime = time.split(':')
      var future = parseInt(splitTime[0]) + 1 
      var newTime = future + ':' + splitTime[1]

      return module.exports.getBuildingHours(payLoad)
      .then(function(result){
        logger.log(result)
        hours = result
        return module.exports.getBuildingComments(payLoad)
      }) 
      .then(function(result){
        logger.log(result)
        comments = result

        return queryService.selectAndJoin(parseInt(payLoad.building_id), day, time)
      })
      .then(function(result){

        var rooms = {}
        var nextBookings = {}
        for (var entry in result){
          var room = result[entry].room_id
          var startTime = result[entry].start_time
          var endTime = result[entry].end_time

          if (!rooms.hasOwnProperty(room)){
            rooms[room] = [result[entry].code];
            nextBookings[room] = startTime

          }
          
          if (startTime < time && endTime > time){
            rooms[room].push('busy_now')
            nextBookings[room] = endTime
          }
          logger.log('Here')
          if (startTime < newTime && endTime > newTime){
            rooms[room].push('busy_later')
          }

        }
        var available = []
        var unavailable = []
        var available_soon = []

        logger.log(nextBookings)

        for (var entry in rooms){
          if (rooms[entry].indexOf('busy_now') != -1){
            if (rooms[entry].indexOf('busy_later') != -1){
              unavailable.push([rooms[entry][0], entry])
            } else {
              available_soon.push([rooms[entry][0], entry, nextBookings[entry]])
            }
          } else {
            available.push([rooms[entry][0], entry, nextBookings[entry]])
          }
        }
        var roomAvailability = {
          "available": available,
          "available_soon": available_soon,
          "unavailable": unavailable
        }
        var buildingInfo = {roomAvailability, hours, comments}
        logger.log(buildingInfo)
        return buildingInfo
      })
      .then(undefined, function(err){
        throw new MyError(err.message, __line, 'user-service.js');
      })
    },
    getRoomInfo: function(payLoad) {
      /*
      Return {Bookings: [], Schedule: []}
      */
      var schedulesAndBookings = {}
      logger.log(payLoad)
      return this.getRoomSchedule(payLoad)
      .then(function(schedule){
        schedulesAndBookings["schedule"] = schedule;
        logger.log(schedule)
        return queryService.select('bookings', 'classroom_id', payLoad.roomId)
      })
      .then(function(bookings){
        logger.log(bookings)
        schedulesAndBookings["bookings"] = bookings;
        logger.log(schedulesAndBookings)
        return schedulesAndBookings;
      })
      .then(undefined, function(err){
        logger.log(err.message);
        throw new MyError(err.message, __line, 'building-service.js');
      })
    },
    createBuilding: function(payLoad) {
      /*
      Creates a building and a schedule
      */
      logger.log(payLoad);
      return queryService.insert('buildings', 'name,address,num_rooms,lat,lon',[payLoad.name, payLoad.address, payLoad.num_rooms, payLoad.lat, payLoad.lon], 'building_id')
      .then(function(result){
        logger.log(result);
        for (var thisDay in payLoad.schedule){
          var time = payLoad.schedule[thisDay].split('-');
            queryService.insert('building_schedule', 'building_id,day,open_time,closing_time', [result.rows[0].building_id, thisDay, time[0], time[1]])
        }
        return result;
      })
      .then(undefined, function(err){
        logger.log("Throwing an error");
        throw new MyError(err.message, __line, 'building-service.js');
      })
    },
    createRoom: function(payLoad) {
      /*
        Creates a room
      */
      logger.log(payLoad);
      return queryService.insert('classrooms', 'building_id,code,occupancy,is_lab',[payLoad.buildingId, payLoad.code, payLoad.occupancy, payLoad.isLab], 'room_id')
      .then(undefined, function(err){
        logger.log("Throwing an error");
        throw new MyError(err.message, __line, 'building-service.js');
      })
    },
    getRoomSchedule: function(payLoad){
      /*
        Returns the schedule associated with this room on this date
      */
      logger.log(payLoad)
      var day = moment().format('dddd')
      logger.log(day)

      return queryService.selectTwoConds('schedules', ['weekday', 'classroom_id'], [day, payLoad.roomId], 'start_time')
      .then(undefined, function(err){
        throw new MyError(err.message, __line, 'building-service.js');
      })
    },
    getBuildingSchedule: function(payLoad){
      /*
        Returns the schedule associated with this building on this date
      */
      logger.log(payLoad)
      var day = moment().format('dddd')
      logger.log(day)

      return queryService.selectTwoConds('schedules', ['weekday', 'building_id'], [day, payLoad.buildingId], 'schedule_id')
      .then(undefined, function(err){
        throw new MyError(err.message, __line, 'user-service.js');
      })
    },
    getBuildingHours: function(payLoad){
      /*
        Returns JSON of building hours for each day
      */
      logger.log(payLoad)
      return queryService.select('building_hours', 'building_id', payLoad.building_id)
      .then(function(result){
        var schedule = {};
        for (var i = 0; i < result.length; i++){
          schedule[result[i].day] = [result[i].open_time, result[i].closing_time]
        }
        return schedule;
      })
    },
    getBuildingComments: function(payLoad){
      /*
        Returns all comments for this building
      */
      logger.log(payLoad)
      return queryService.select('comments', 'building_id', payLoad.building_id)
      .then(undefined, function(err){
        throw new MyError(err.message, __line, 'user-service.js');
      })
    }
  };
})();

module.exports = buildingService;

