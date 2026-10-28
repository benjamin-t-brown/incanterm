import { getIfExists as getQuest } from '_db/quests';
import { getTileChIsObstructedBy } from 'model/character';
import { Character } from 'model/character-type';
import {
  getCameraTransform,
  getCurrentPlayer,
  getCurrentRoom,
  getCurrentScene,
} from 'model/generics';
import { playerHasPartyMember } from 'model/player';
import {
  getCurrentQuestStep,
  questIsActive,
  questIsCompleted,
  questIsNotStarted as questIsNotStartedExp,
} from 'model/quest';
import { Room, roomGetTileBelow } from 'model/room';
import { Point, areArraysDifferent } from 'utils';

const questActive = (questName: string) => {
  const quest = getQuest(questName);
  if (!quest) {
    console.error(
      `Error in conditional.  Cannot check questActive.  No quest with name: ${questName}`
    );
    return false;
  }

  return questIsActive(getCurrentScene(), quest);
};

const questIsStarted = (questName: string) => {
  return questActive(questName) || questCompleted(questName);
};

const questNotStarted = (questName: string) => {
  const quest = getQuest(questName);
  if (!quest) {
    console.error(
      `Error in conditional.  Cannot check questNotStarted.  No quest with name: ${questName}`
    );
    return false;
  }

  return questIsNotStartedExp(getCurrentScene(), quest);
};
const questIsNotStarted = (questName: string) => {
  return questNotStarted(questName);
};

const questCompleted = (questName: string) => {
  const quest = getQuest(questName);
  if (!quest) {
    console.error(
      `Error in conditional.  Cannot check questCompleted.  No quest with name: ${questName}`
    );
    return false;
  }

  const compl = questIsCompleted(getCurrentScene(), quest);
  return compl;
};

const questNotCompleted = (questName: string) => {
  const quest = getQuest(questName);
  if (!quest) {
    console.error(
      `Error in conditional.  Cannot check questNotCompleted.  No quest with name: ${questName}`
    );
    return false;
  }

  const compl = questIsCompleted(getCurrentScene(), quest);
  return !compl;
};

const questStepGT = (questName: string, stepNumber: string | number) => {
  const i = parseInt(stepNumber as string);

  const quest = getQuest(questName);
  if (!quest) {
    console.error(
      `Error in conditional.  Cannot check questStepGT.  No quest with name: ${questName}`
    );
    return false;
  }
  const step = getCurrentQuestStep(getCurrentScene(), questName);

  if (questIsCompleted(getCurrentScene(), quest)) {
    return false;
  }

  return (step?.i ?? Infinity) > i;
};

const questStepLT = (questName: string, stepNumber: string | number) => {
  const i = parseInt(stepNumber as string);

  const quest = getQuest(questName);
  if (!quest) {
    console.error(
      `Error in conditional.  Cannot check questStepLT.  No quest with name: ${questName}`
    );
    return false;
  }
  const step = getCurrentQuestStep(getCurrentScene(), questName);

  if (questIsCompleted(getCurrentScene(), quest)) {
    return false;
  }

  return (step?.i ?? Infinity) < i;
};

const questStepEQ = (questName: string, stepNumber: string | number) => {
  const i = parseInt(stepNumber as string);

  const quest = getQuest(questName);
  if (!quest) {
    console.error(
      `Error in conditional.  Cannot check questStepEQ.  No quest with name: ${questName}`
    );
    return false;
  }
  const step = getCurrentQuestStep(getCurrentScene(), questName);

  if (questIsCompleted(getCurrentScene(), quest)) {
    return false;
  }

  return (step?.i ?? Infinity) === i;
};

const inParty = (chName: string) => {
  const player = getCurrentPlayer();
  const chNameLower = chName.toLowerCase();
  return playerHasPartyMember(player, chNameLower);
};

const numPartyMembersLT = (cmp: number) => {
  const player = getCurrentPlayer();
  return player.party.length < cmp;
};

const numPartyMembersGT = (cmp: number) => {
  const player = getCurrentPlayer();
  return player.party.length > cmp;
};

const numPartyMembersEQ = (cmp: number) => {
  const player = getCurrentPlayer();
  return player.party.length === Number(cmp);
};

const hasEnoughTokens = (tokens: string | number) => {
  const player = getCurrentPlayer();
  return player.tokens >= Number(tokens);
};

const hasEnoughTickets = (tickets: string | number) => {
  const player = getCurrentPlayer();
  return player.tickets >= Number(tickets);
};

const carryingProp = (propName: string) => {
  const player = getCurrentPlayer();
  return Boolean(player.attachedProps.find(prop => prop.name === propName));
};

const roomHasProp = (propName: string) => {
  const room = getCurrentRoom();
  const prop = room.props.find(p => p.name === propName);
  return Boolean(prop);
};

const tileAtMarkerIsOccupied = (
  markerName: string,
  xOffset?: number,
  yOffset?: number
) => {
  const room = getCurrentRoom();
  const marker = room.markers[markerName];
  if (marker) {
    const target = [
      marker.x + (xOffset ?? 0),
      marker.y + (yOffset ?? 0),
    ] as Point;
    return tileAtPositionIsOccupied(...target);
  }
};

const getCharactersWhoAreObstructed = (room: Room) => {
  const arr: Character[] = [];
  for (const ch of room.characters) {
    if (getTileChIsObstructedBy(ch, room)) {
      arr.push(ch);
    }
  }
  return arr;
};

export const tileAtPositionIsOccupied = (
  x: number | string,
  y: number | string
) => {
  let isOccupied = false;
  const room = getCurrentRoom();
  x = Number(x);
  y = Number(y);
  const tile = roomGetTileBelow(room, [x, y], room.currentTileLayer);
  if (tile) {
    const currentlyObstructed = getCharactersWhoAreObstructed(room);
    const oldIsWall = tile.isWall;
    const oldIsProp = tile.isProp;
    tile.isWall = true;
    tile.isProp = true;

    const potentiallyObstructed = getCharactersWhoAreObstructed(room);
    if (areArraysDifferent(currentlyObstructed, potentiallyObstructed)) {
      isOccupied = true;
    }

    tile.isWall = oldIsWall;
    tile.isProp = oldIsProp;

    if (isOccupied) {
      return true;
    }

    for (const prop of room.props) {
      const { x, y } = prop;
      const tileBelow = roomGetTileBelow(
        room,
        [x - 4, y - 4],
        room.currentTileLayer
      );
      if (tileBelow === tile) {
        return true;
      }
    }
  }
  return false;
};

export const isCameraOnPlayer = () => {
  const ret = !getCameraTransform();

  console.log('isCameraOnPlayer', ret);
  return ret;
};

const exp = {
  questActive,
  questIsStarted,
  questStarted: questIsStarted,
  questNotStarted,
  questIsNotStarted,
  questCompleted,
  questNotCompleted,
  questStepGT,
  questStepLT,
  questStepEQ,
  inParty,
  numPartyMembersLT,
  numPartyMembersGT,
  numPartyMembersEQ,
  hasEnoughTokens,
  hasEnoughTickets,
  carryingProp,
  roomHasProp,
  tileAtMarkerIsOccupied,
  tileAtPositionIsOccupied,
  isCameraOnPlayer,
};

export default exp;
