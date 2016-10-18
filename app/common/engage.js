const moment = require('moment-timezone');
const path = require('path');
const {readlines} = require('./readlines');

function normalizeSubjectCode(rawCode) {
  if (rawCode.indexOf('test') !== -1) {
    console.error(`ran into test user data: ${rawCode}`);
    return rawCode;
  }
  let match = /[a-zA-Z]{2}(\d{5})/.exec(rawCode);
  if (!match) {
    match = /\b000(\d{5})-\d\b/.exec(rawCode);
  }
  if (!match) {
    throw new Error(`ran into code that we couldn't parse: ${rawCode}`);
  }
  return match[1];
}
exports.normalizeSubjectCode = normalizeSubjectCode;

function pacificDayFormat(m) {
  return m.tz('America/Los_Angeles').format('YYYY-MM-DD');
}

function getAcquisitionMetadata(normalizedSubject, fileDate, filePath, subjectSessions) {
  if (!subjectSessions) {
    throw new Error(`subject ${normalizedSubject} has no sessions.`);
  }

  const date = pacificDayFormat(fileDate);
  const session = subjectSessions.find(s =>
    pacificDayFormat(moment(s.timestamp)) === date);
  if (!session) {
    throw new Error(`Could not find session for ${normalizedSubject} on ${date}.`);
  }
  if (!session.uid) {
    throw new Error(`session id=${session.uid}:${session.label} has no uid`);
  }
  if (!session.timestamp) {
    throw new Error(`session id=${session.uid}:${session.label} has no timestamp`);
  }

  const acquisitionDate = fileDate.tz('UTC');
  const sessionDate = moment.tz(session.timestamp, 'UTC');

  // We try to keep this UID something computable from the session to
  // ensure there is a globally unique and deterministically computable
  // key for every upload. This helps simplify the data synchronization
  // with the server, which would otherwise have to identify the previous
  // acquisition based on the label or other metadata.
  const acquisitionUID = `behavioral_and_physiological:${session.uid}`;

  return {
    AcquisitionDate: acquisitionDate.format('YYYYMMDD'),
    AcquisitionTime: acquisitionDate.format('HHmmss'),
    SeriesInstanceUID: acquisitionUID,
    SeriesDescription: 'Behavioral and Physiological',
    // from session
    StudyDate: sessionDate.format('YYYYMMDD'),
    StudyTime: sessionDate.format('HHmmss'),
    // HACK we make sure to attach the exact same subject code (instead
    // of the normalized code) to our upload so that insert/update code
    // will find the right session for this file.
    PatientID: session.subject.code,
    StudyInstanceUID: session.uid
  };
}

function extractMetadata(buffer, filePath) {
  const lines = [];
  for (const line of readlines(buffer)) {
    lines.push(line);
    if (lines.length > 30) {
      break;
    }
  }
  const csvHeader = lines[0].split(',');
  let subjectCode;
  let fileDate;
  const physioPrefix = '% Start time: ';
  if (lines[0].startsWith(physioPrefix)) {
    // Physio data files
    const splitPath = filePath.split(path.sep);
    // physio data files are in a folder named by the subject code
    subjectCode = normalizeSubjectCode(splitPath[splitPath.length - 2]);
    fileDate = moment.tz(lines[0].slice(physioPrefix.length), 'YYYY-MM-DD HH:mm:ss.SSSSSS', 'UTC')
  } else if (lines.indexOf('Product = ispot') !== -1) {
    // ispot behavioral data
    const prefix = 'DateTime = ';
    const dateLine = lines.find(line => line.startsWith(prefix));
    fileDate = moment.tz(dateLine.slice(prefix.length), 'YYYY/MM/DD HH:mm:ss', 'America/Los_Angeles');
    subjectCode = normalizeSubjectCode(path.basename(filePath).split('_')[0])
  } else if (csvHeader.indexOf('date') !== -1 && csvHeader.indexOf('participant') !== -1) {
    // emotional regulation data
    const row = lines[1].split(',');
    // XXX make sure this will work for all month names?
    const dateString = row[csvHeader.indexOf('date')];
    fileDate = moment.tz(dateString, 'YYYY_MMM_DD HHmm', 'America/Los_Angeles');
    subjectCode = normalizeSubjectCode(row[csvHeader.indexOf('participant')]);
  }
  if (!subjectCode || !fileDate) {
    throw new Error(`Could not parse ${filePath}`);
  }
  if (!fileDate.isValid()) {
    throw new Error(`Could not parse date string ${fileDate._i} for ${filePath}`);
  }
  return {
    fileDate,
    subjectCode
  };
}

// exported for testing
exports._extractMetadata = extractMetadata;

exports.tryParseENGAGE = function tryParseENGAGE(buffer, filePath, subjectToSessions) {
  const {
    fileDate,
    subjectCode
  } = extractMetadata(buffer, filePath);

  return Object.assign({
    // dummy value to make downstream code work.
    Manufacturer: ''
  }, getAcquisitionMetadata(subjectCode, fileDate, filePath, subjectToSessions[subjectCode]));
};