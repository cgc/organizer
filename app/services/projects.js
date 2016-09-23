'use strict';
const angular = require('angular');
const app = angular.module('app');
const {readFilePromise} = require('../common/util.js');
const archiver = require('archiver');

function projectsService(fileSystemQueues) {

  return {
    save: save
  };
  function createZip(files) {
    var promise = new Promise(function(resolve){
      let archive = archiver.create('zip', {});
      archive.on('end', function() {
        console.log('zip process completed');
      });
      var p = new Promise(function(resolve){
        resolve(archive);
      });
      files.reduce(function(p, f) {
        return p.then(function(archive){
          return readFilePromise(f).then(function(rs){
            return archive.append(rs, {name: f.split('/').pop()});
          });
        });
      }, p).then(function(archive){
        archive.finalize();
        resolve(archive);
      });
    });
    return promise;
  }
  function save(projects, path){
    const allPromises = [];
    projects.forEach((p) => {
      if (p.state !== 'checked' && p.state !== 'indeterminate'){
        return;
      }
      const projectPath = path + '/' + p.label;
      const projectDir_ = fileSystemQueues.append({
        operation: 'mkdir',
        path: projectPath
      });
      allPromises.push(projectDir_);
      Object.keys(p.children).forEach((sessionUID) => {
        const sessionPath = projectPath + '/' + sessionUID;
        const session = p.children[sessionUID];
        if (session.state !== 'checked' && session.state !== 'indeterminate'){
          return;
        }
        const sessionDir_ = fileSystemQueues.append({
          operation: 'mkdir',
          path: sessionPath,
          waitFor: projectDir_
        });
        allPromises.push(sessionDir_);
        Object.keys(session.children).forEach((acquisitionUID) => {
          const acqPath = sessionPath + '/' + acquisitionUID;
          const acquisition = session.children[acquisitionUID];
          if (acquisition.state !== 'checked' && acquisition.state !== 'indeterminate'){
            return;
          }
          const acqDir_ = fileSystemQueues.append({
            operation: 'mkdir',
            path: acqPath,
            waitFor: sessionDir_
          });
          const archivePromise = createZip(acquisition.filepaths);
          const zipPath = acqPath + '/' + acquisitionUID + '.zip';
          allPromises.push(fileSystemQueues.append({
            operation: 'write',
            path: zipPath,
            content_: archivePromise,
            waitFor: acqDir_
          }));
        });
      });
    });
    return Promise.all(allPromises);
  }
}
projectsService.$inject = ['fileSystemQueues'];
app.factory('projectsService', projectsService);