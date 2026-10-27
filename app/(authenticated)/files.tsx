import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../../components/ui/Card';
import { FilePreview, type DrawingBox, type FilePreviewSpec } from '../../components/files/FilePreview';
import { useProject } from '../../lib/ProjectContext';
import { useSafeBottomOffset } from '../../lib/useSafeBottomOffset';

// Files — project documents organised into folders (Drawings, Transmittal,
// RA Bills, Quotes -> Comparative/Finalised). DUMMY DATA ONLY for now, by
// explicit request (client presentation) — nothing here reads or writes
// Supabase yet. Swap FOLDERS for a real fetch once the storage side exists.
//
// Files are project-specific: from the drawer you pick a project first
// (Files > Project > Folder); from a project's own dashboard it's opened
// with ?projectId=... and lands straight in that project's folders. Every
// project shows the same dummy folder set for now.

type FileKind = 'pdf' | 'dwg' | 'xlsx' | 'docx' | 'img' | 'other';

interface DummyFile {
  name: string;
  kind: FileKind;
  size: string;
  date: string;
  by: string;
  note?: string;
  // Drawings + RA Bills — drive the Department / Floor filters in those folders.
  department?: string;
  floor?: string;
  preview: FilePreviewSpec;
}

// Filter options for the Drawings and RA Bills folders, in display order.
const DRAWING_DEPARTMENTS = ['Architectural', 'Structural', 'Electrical', 'Plumbing', 'HVAC', 'Interior'];
const DRAWING_FLOORS = ['Foundation', 'Ground Floor', 'First Floor', 'Second Floor', 'Terrace', 'All Floors'];

interface Folder {
  id: string;
  name: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  files?: DummyFile[];
  subfolders?: Folder[];
}

// Shared ground-floor room layout, reused (with different overlays) by the
// plan/electrical/plumbing drawings below.
const GF_ROOMS: DrawingBox[] = [
  { label: 'LIVING\n4.5 x 5.2 m', x: 4, y: 6, w: 44, h: 46 },
  { label: 'KITCHEN\n3.0 x 3.6 m', x: 48, y: 6, w: 26, h: 30 },
  { label: 'DINING\n3.0 x 3.0 m', x: 48, y: 36, w: 26, h: 26 },
  { label: 'BED 1\n3.6 x 3.9 m', x: 74, y: 6, w: 22, h: 44 },
  { label: 'TOILET', x: 74, y: 50, w: 22, h: 18, fill: 'rgba(165,243,252,0.35)' },
  { label: 'BED 2\n3.3 x 3.6 m', x: 4, y: 52, w: 30, h: 42 },
  { label: 'STAIR', x: 34, y: 62, w: 14, h: 32, fill: 'rgba(254,215,170,0.4)' },
  { label: 'FOYER', x: 48, y: 62, w: 26, h: 32 },
  { label: 'UTILITY', x: 74, y: 68, w: 22, h: 26, fill: 'rgba(221,214,254,0.35)' },
];
const FF_ROOMS: DrawingBox[] = [
  { label: 'MASTER BED\n4.2 x 4.8 m', x: 4, y: 6, w: 44, h: 46 },
  { label: 'DRESS', x: 48, y: 6, w: 16, h: 24, fill: 'rgba(221,214,254,0.35)' },
  { label: 'TOILET', x: 64, y: 6, w: 32, h: 24, fill: 'rgba(165,243,252,0.35)' },
  { label: 'FAMILY LOUNGE\n4.0 x 4.2 m', x: 48, y: 30, w: 48, h: 34 },
  { label: 'BED 3\n3.3 x 3.6 m', x: 4, y: 52, w: 30, h: 42 },
  { label: 'STAIR', x: 34, y: 62, w: 14, h: 32, fill: 'rgba(254,215,170,0.4)' },
  { label: 'BALCONY', x: 48, y: 64, w: 48, h: 30, fill: 'rgba(187,247,208,0.35)' },
];

const FOLDERS: Folder[] = [
  {
    id: 'drawings',
    name: 'Drawings',
    description: 'Architectural, structural & MEP drawings',
    icon: 'map-outline',
    color: '#2563EB',
    files: [
      {
        name: 'Ground Floor Plan — Rev C.pdf', department: 'Architectural', floor: 'Ground Floor', kind: 'pdf', size: '2.4 MB', date: '22 Sep 2026', by: 'Architect', note: 'Latest revision',
        preview: { type: 'drawing', sheetNo: 'A-101 / Rev C', scale: '1:100', drawnBy: 'Architect', boxes: GF_ROOMS, notes: ['All dimensions are in metres unless noted.', 'Floor finish level +0.45 m from road level.', 'Rev C: kitchen enlarged by 0.3 m towards dining.'] },
      },
      {
        name: 'First Floor Plan — Rev B.pdf', department: 'Architectural', floor: 'First Floor', kind: 'pdf', size: '2.1 MB', date: '18 Sep 2026', by: 'Architect',
        preview: { type: 'drawing', sheetNo: 'A-102 / Rev B', scale: '1:100', drawnBy: 'Architect', boxes: FF_ROOMS, notes: ['All dimensions are in metres unless noted.', 'Balcony railing height 1.05 m (MS + glass).'] },
      },
      {
        name: 'Footing & Column Details — R2.dwg', department: 'Structural', floor: 'Foundation', kind: 'dwg', size: '5.8 MB', date: '15 Sep 2026', by: 'Structural Consultant',
        preview: {
          type: 'drawing', sheetNo: 'S-201 / R2', scale: '1:50', drawnBy: 'Structural', notes: ['Concrete grade M25 for footings, M30 for columns.', 'PCC 1:4:8, 100 mm thick below all footings.', 'Clear cover to footing reinforcement 50 mm.'],
          boxes: [
            { label: 'F1\n1.8x1.8', x: 6, y: 8, w: 20, h: 22, fill: 'rgba(203,213,225,0.5)' },
            { label: 'F1\n1.8x1.8', x: 40, y: 8, w: 20, h: 22, fill: 'rgba(203,213,225,0.5)' },
            { label: 'F2\n2.1x2.1', x: 74, y: 6, w: 22, h: 26, fill: 'rgba(203,213,225,0.5)' },
            { label: 'F2\n2.1x2.1', x: 6, y: 40, w: 22, h: 26, fill: 'rgba(203,213,225,0.5)' },
            { label: 'F3\n2.4x2.4', x: 38, y: 38, w: 24, h: 30, fill: 'rgba(203,213,225,0.5)' },
            { label: 'F2\n2.1x2.1', x: 74, y: 40, w: 22, h: 26, fill: 'rgba(203,213,225,0.5)' },
            { label: 'F1', x: 6, y: 74, w: 20, h: 20, fill: 'rgba(203,213,225,0.5)' },
            { label: 'F1', x: 40, y: 74, w: 20, h: 20, fill: 'rgba(203,213,225,0.5)' },
            { label: 'F1', x: 74, y: 74, w: 20, h: 20, fill: 'rgba(203,213,225,0.5)' },
          ],
        },
      },
      {
        name: 'Front & Side Elevations.pdf', department: 'Architectural', floor: 'All Floors', kind: 'pdf', size: '3.2 MB', date: '10 Sep 2026', by: 'Architect',
        preview: {
          type: 'drawing', sheetNo: 'A-301', scale: '1:100', drawnBy: 'Architect', notes: ['External finish: texture paint with stone cladding at plinth.', 'Parapet height 1.0 m above terrace level.'],
          boxes: [
            { label: 'PARAPET', x: 6, y: 4, w: 88, h: 8, fill: 'rgba(203,213,225,0.5)' },
            { label: 'W', x: 12, y: 18, w: 18, h: 18 },
            { label: 'BALCONY', x: 40, y: 18, w: 26, h: 22, fill: 'rgba(187,247,208,0.35)' },
            { label: 'W', x: 72, y: 18, w: 16, h: 18 },
            { label: 'W', x: 12, y: 54, w: 18, h: 18 },
            { label: 'MAIN DOOR', x: 42, y: 50, w: 16, h: 34, fill: 'rgba(254,215,170,0.45)' },
            { label: 'W', x: 72, y: 54, w: 16, h: 18 },
            { label: 'PLINTH — STONE CLADDING', x: 2, y: 86, w: 96, h: 10, fill: 'rgba(214,211,209,0.7)' },
          ],
        },
      },
      {
        name: 'Electrical Layout — Ground Floor.pdf', department: 'Electrical', floor: 'Ground Floor', kind: 'pdf', size: '1.6 MB', date: '08 Sep 2026', by: 'MEP Consultant',
        preview: {
          type: 'drawing', sheetNo: 'E-101', scale: '1:100', drawnBy: 'MEP', boxes: GF_ROOMS, notes: ['Red points: light / power outlets.', 'All wiring in PVC conduit concealed in wall.', 'DB located in utility; MCB per circuit.'],
          points: [
            { x: 20, y: 22, label: 'L1' }, { x: 36, y: 36, label: 'P1' }, { x: 58, y: 16, label: 'P2' }, { x: 62, y: 46, label: 'L2' },
            { x: 84, y: 22, label: 'AC' }, { x: 84, y: 58, label: 'EF' }, { x: 16, y: 70, label: 'L3' }, { x: 60, y: 76, label: 'L4' }, { x: 84, y: 80, label: 'DB' },
          ],
        },
      },
      {
        name: 'Plumbing & Drainage Layout.pdf', department: 'Plumbing', floor: 'Ground Floor', kind: 'pdf', size: '1.9 MB', date: '05 Sep 2026', by: 'MEP Consultant',
        preview: {
          type: 'drawing', sheetNo: 'P-101', scale: '1:100', drawnBy: 'MEP', boxes: GF_ROOMS, notes: ['Red points: water supply / drain points.', 'CPVC for supply lines, uPVC SWR for drainage.', 'Inspection chambers at every change in direction.'],
          points: [
            { x: 56, y: 12, label: 'SINK' }, { x: 80, y: 54, label: 'WC' }, { x: 90, y: 60, label: 'FT' }, { x: 80, y: 76, label: 'WM' }, { x: 94, y: 90, label: 'IC' },
          ],
        },
      },
      {
        name: 'Second Floor Plan — Rev A.pdf', kind: 'pdf', size: '2.0 MB', date: '21 Sep 2026', by: 'Architect', department: 'Architectural', floor: 'Second Floor',
        preview: { type: 'drawing', sheetNo: 'A-103 / Rev A', scale: '1:100', drawnBy: 'Architect', boxes: FF_ROOMS, notes: ['All dimensions are in metres unless noted.', 'Home theatre in place of family lounge (client request).'] },
      },
      {
        name: 'Terrace Plan & Waterproofing.pdf', kind: 'pdf', size: '1.4 MB', date: '17 Sep 2026', by: 'Architect', department: 'Architectural', floor: 'Terrace',
        preview: {
          type: 'drawing', sheetNo: 'A-104', scale: '1:100', drawnBy: 'Architect', notes: ['APP membrane waterproofing with 1:100 slope to drains.', 'Rain water outlets at 4 corners.'],
          boxes: [
            { label: 'OPEN TERRACE', x: 4, y: 6, w: 62, h: 88, fill: 'rgba(187,247,208,0.3)' },
            { label: 'STAIR\nHEAD ROOM', x: 66, y: 6, w: 30, h: 30, fill: 'rgba(254,215,170,0.4)' },
            { label: 'OHT\n5000 L', x: 66, y: 36, w: 30, h: 26, fill: 'rgba(165,243,252,0.35)' },
            { label: 'SOLAR PANELS', x: 66, y: 62, w: 30, h: 32, fill: 'rgba(203,213,225,0.5)' },
          ],
        },
      },
      {
        name: 'Plinth Beam Layout — R1.dwg', kind: 'dwg', size: '4.1 MB', date: '12 Sep 2026', by: 'Structural Consultant', department: 'Structural', floor: 'Foundation',
        preview: {
          type: 'drawing', sheetNo: 'S-202 / R1', scale: '1:100', drawnBy: 'Structural', notes: ['Plinth beams PB1 230x450, M25.', 'Top of plinth beam at +0.45 m.'],
          boxes: [
            { label: 'PB1', x: 4, y: 6, w: 92, h: 6, fill: 'rgba(203,213,225,0.6)' },
            { label: 'PB1', x: 4, y: 50, w: 92, h: 6, fill: 'rgba(203,213,225,0.6)' },
            { label: 'PB1', x: 4, y: 88, w: 92, h: 6, fill: 'rgba(203,213,225,0.6)' },
            { label: 'PB2', x: 4, y: 6, w: 6, h: 88, fill: 'rgba(203,213,225,0.6)' },
            { label: 'PB2', x: 47, y: 6, w: 6, h: 88, fill: 'rgba(203,213,225,0.6)' },
            { label: 'PB2', x: 90, y: 6, w: 6, h: 88, fill: 'rgba(203,213,225,0.6)' },
          ],
        },
      },
      {
        name: 'First Floor Slab Reinforcement — R1.dwg', kind: 'dwg', size: '4.6 MB', date: '19 Sep 2026', by: 'Structural Consultant', department: 'Structural', floor: 'First Floor',
        preview: {
          type: 'drawing', sheetNo: 'S-301 / R1', scale: '1:50', drawnBy: 'Structural', notes: ['Slab thickness 150 mm, M25.', 'Main bars 10 mm @ 150 c/c, distribution 8 mm @ 200 c/c.'],
          boxes: [
            { label: 'S1 — 150 THK', x: 4, y: 6, w: 44, h: 46, fill: 'rgba(203,213,225,0.4)' },
            { label: 'S2 — 150 THK', x: 48, y: 6, w: 48, h: 46, fill: 'rgba(203,213,225,0.4)' },
            { label: 'S3 — 125 THK', x: 4, y: 52, w: 44, h: 42, fill: 'rgba(203,213,225,0.4)' },
            { label: 'CANTILEVER\nBALCONY', x: 48, y: 52, w: 48, h: 42, fill: 'rgba(187,247,208,0.35)' },
          ],
        },
      },
      {
        name: 'Electrical Layout — First Floor.pdf', kind: 'pdf', size: '1.5 MB', date: '14 Sep 2026', by: 'MEP Consultant', department: 'Electrical', floor: 'First Floor',
        preview: {
          type: 'drawing', sheetNo: 'E-102', scale: '1:100', drawnBy: 'MEP', boxes: FF_ROOMS, notes: ['Red points: light / power outlets.', 'Separate circuit for each AC point.'],
          points: [{ x: 22, y: 26, label: 'L1' }, { x: 40, y: 12, label: 'AC' }, { x: 78, y: 16, label: 'EF' }, { x: 70, y: 44, label: 'TV' }, { x: 18, y: 72, label: 'L2' }, { x: 70, y: 78, label: 'L3' }],
        },
      },
      {
        name: 'HVAC Ducting Layout — Ground Floor.pdf', kind: 'pdf', size: '1.8 MB', date: '11 Sep 2026', by: 'MEP Consultant', department: 'HVAC', floor: 'Ground Floor',
        preview: {
          type: 'drawing', sheetNo: 'M-101', scale: '1:100', drawnBy: 'MEP', boxes: GF_ROOMS, notes: ['Red points: supply air diffusers / outdoor units.', 'Ducted split for living + dining, wall splits in bedrooms.'],
          points: [{ x: 20, y: 18, label: 'SAD' }, { x: 36, y: 34, label: 'SAD' }, { x: 58, y: 48, label: 'SAD' }, { x: 84, y: 16, label: 'AC' }, { x: 18, y: 66, label: 'AC' }, { x: 94, y: 4, label: 'ODU' }],
        },
      },
      {
        name: 'Plumbing — First Floor Toilets.pdf', kind: 'pdf', size: '1.2 MB', date: '13 Sep 2026', by: 'MEP Consultant', department: 'Plumbing', floor: 'First Floor',
        preview: {
          type: 'drawing', sheetNo: 'P-102', scale: '1:50', drawnBy: 'MEP', boxes: FF_ROOMS, notes: ['Red points: water supply / drain points.', 'Concealed cistern for wall-hung WC.'],
          points: [{ x: 72, y: 12, label: 'WC' }, { x: 84, y: 12, label: 'WB' }, { x: 90, y: 22, label: 'SH' }, { x: 56, y: 14, label: 'FT' }],
        },
      },
      {
        name: 'Interior — Living Room Ceiling Detail.pdf', kind: 'pdf', size: '2.6 MB', date: '20 Sep 2026', by: 'Interior Designer', department: 'Interior', floor: 'Ground Floor',
        preview: {
          type: 'drawing', sheetNo: 'I-101', scale: '1:50', drawnBy: 'Interior', notes: ['Gypsum false ceiling at 2.85 m with cove lighting.', 'Wooden rafter feature over sofa area.'],
          boxes: [
            { label: 'FALSE CEILING +2.85', x: 4, y: 6, w: 92, h: 88, fill: 'rgba(254,243,199,0.4)' },
            { label: 'COVE LIGHT', x: 14, y: 16, w: 72, h: 10, fill: 'rgba(253,230,138,0.6)' },
            { label: 'WOODEN RAFTERS', x: 14, y: 36, w: 72, h: 30, fill: 'rgba(214,211,209,0.6)' },
            { label: 'COVE LIGHT', x: 14, y: 74, w: 72, h: 10, fill: 'rgba(253,230,138,0.6)' },
          ],
        },
      },
    ],
  },
  {
    id: 'transmittal',
    name: 'Transmittal',
    description: 'Document transmittals issued & received',
    icon: 'swap-horizontal-outline',
    color: '#0D9488',
    files: [
      {
        name: 'TR-004 — Revised GF Plan to Contractor.pdf', kind: 'pdf', size: '420 KB', date: '23 Sep 2026', by: 'PMC', note: 'Acknowledged',
        preview: { type: 'transmittal', ref: 'TR-004 · 23 Sep 2026', to: 'Main Contractor — Site Office', from: 'PMC — Project Manager', purpose: 'For construction', status: 'Acknowledged', items: [{ drawingNo: 'A-101', title: 'Ground Floor Plan', rev: 'C', releaseDate: '22 Sep 2026', copies: 2 }, { drawingNo: 'A-501', title: 'Kitchen Enlarged Detail', rev: 'A', releaseDate: '22 Sep 2026', copies: 2 }, { drawingNo: 'I-101', title: 'Living Room Ceiling Detail', rev: '0', releaseDate: '20 Sep 2026', copies: 1 }] },
      },
      {
        name: 'TR-003 — Structural Drawings to Site.pdf', kind: 'pdf', size: '380 KB', date: '16 Sep 2026', by: 'PMC', note: 'Acknowledged',
        preview: { type: 'transmittal', ref: 'TR-003 · 16 Sep 2026', to: 'Site Engineer', from: 'PMC — Project Manager', purpose: 'For construction', status: 'Acknowledged', items: [{ drawingNo: 'S-201', title: 'Footing & Column Details', rev: 'R2', releaseDate: '15 Sep 2026', copies: 3 }, { drawingNo: 'S-202', title: 'Plinth Beam Layout', rev: 'R1', releaseDate: '12 Sep 2026', copies: 3 }, { drawingNo: 'S-203', title: 'Column Schedule', rev: 'R1', releaseDate: '12 Sep 2026', copies: 3 }, { drawingNo: 'S-301', title: 'First Floor Slab Reinforcement', rev: 'R1', releaseDate: '16 Sep 2026', copies: 3 }] },
      },
      {
        name: 'TR-002 — MEP Drawings to Contractor.pdf', kind: 'pdf', size: '350 KB', date: '09 Sep 2026', by: 'PMC', note: 'Pending acknowledgement',
        preview: { type: 'transmittal', ref: 'TR-002 · 09 Sep 2026', to: 'MEP Contractor', from: 'PMC — Project Manager', purpose: 'For review & comments', status: 'Pending acknowledgement', items: [{ drawingNo: 'E-101', title: 'Electrical Layout — Ground Floor', rev: '0', releaseDate: '08 Sep 2026', copies: 2 }, { drawingNo: 'P-101', title: 'Plumbing & Drainage Layout', rev: '0', releaseDate: '05 Sep 2026', copies: 2 }, { drawingNo: 'M-101', title: 'HVAC Ducting Layout — Ground Floor', rev: '0', releaseDate: '09 Sep 2026', copies: 2 }] },
      },
      {
        name: 'TR-001 — Tender Drawings Set.pdf', kind: 'pdf', size: '610 KB', date: '28 Aug 2026', by: 'PMC', note: 'Acknowledged',
        preview: { type: 'transmittal', ref: 'TR-001 · 28 Aug 2026', to: 'Main Contractor', from: 'PMC — Project Manager', purpose: 'For tender / pricing', status: 'Acknowledged', items: [{ drawingNo: 'A-101', title: 'Ground Floor Plan', rev: 'A', releaseDate: '20 Aug 2026', copies: 1 }, { drawingNo: 'A-102', title: 'First Floor Plan', rev: 'A', releaseDate: '20 Aug 2026', copies: 1 }, { drawingNo: 'A-301', title: 'Front & Side Elevations', rev: 'A', releaseDate: '22 Aug 2026', copies: 1 }, { drawingNo: 'S-101', title: 'Foundation Layout', rev: 'R0', releaseDate: '25 Aug 2026', copies: 1 }] },
      },
    ],
  },
  {
    id: 'ra-bills',
    name: 'RA Bills',
    description: 'Running account bills from contractors',
    icon: 'receipt-outline',
    color: '#D97706',
    files: [
      {
        name: 'RA Bill 03 — Civil Works.pdf', department: 'Structural', floor: 'First Floor', kind: 'pdf', size: '1.1 MB', date: '20 Sep 2026', by: 'Contractor', note: 'Under review',
        preview: { type: 'bill', billNo: 'RA-03', period: '26 Aug – 20 Sep 2026', contractor: 'Main Contractor', status: 'Under review', previousCertified: 1095000, items: [{ desc: 'Earthwork excavation', unit: 'CUM', qty: 420, rate: 350 }, { desc: 'PCC 1:4:8', unit: 'CUM', qty: 38, rate: 5200 }, { desc: 'RCC M25 — footings', unit: 'CUM', qty: 64, rate: 7800 }, { desc: 'RCC M30 — columns', unit: 'CUM', qty: 22, rate: 8600 }, { desc: 'Reinforcement steel', unit: 'MT', qty: 14.5, rate: 68000 }, { desc: 'Brickwork 230 mm', unit: 'CUM', qty: 55, rate: 6400 }] },
      },
      {
        name: 'RA Bill 02 — Civil Works.pdf', department: 'Structural', floor: 'Ground Floor', kind: 'pdf', size: '980 KB', date: '25 Aug 2026', by: 'Contractor', note: 'Certified',
        preview: { type: 'bill', billNo: 'RA-02', period: '31 Jul – 25 Aug 2026', contractor: 'Main Contractor', status: 'Certified', previousCertified: 475000, items: [{ desc: 'Earthwork excavation', unit: 'CUM', qty: 420, rate: 350 }, { desc: 'PCC 1:4:8', unit: 'CUM', qty: 38, rate: 5200 }, { desc: 'RCC M25 — footings', unit: 'CUM', qty: 40, rate: 7800 }, { desc: 'Reinforcement steel', unit: 'MT', qty: 6.2, rate: 68000 }] },
      },
      {
        name: 'RA Bill 01 — Earthwork & PCC.pdf', department: 'Structural', floor: 'Foundation', kind: 'pdf', size: '870 KB', date: '30 Jul 2026', by: 'Contractor', note: 'Paid',
        preview: { type: 'bill', billNo: 'RA-01', period: '01 Jul – 30 Jul 2026', contractor: 'Main Contractor', status: 'Paid', previousCertified: 0, items: [{ desc: 'Site clearance', unit: 'SQM', qty: 600, rate: 45 }, { desc: 'Earthwork excavation', unit: 'CUM', qty: 380, rate: 350 }, { desc: 'PCC 1:4:8', unit: 'CUM', qty: 30, rate: 5200 }, { desc: 'Anti-termite treatment', unit: 'SQM', qty: 520, rate: 60 }] },
      },
      {
        name: 'RA Bill Measurement Sheet — 03.xlsx', department: 'Structural', floor: 'Foundation', kind: 'xlsx', size: '240 KB', date: '20 Sep 2026', by: 'Site Engineer',
        preview: {
          type: 'sheet', sheetName: 'MB-03', columns: ['Description', 'Nos', 'Length (m)', 'Breadth (m)', 'Depth (m)', 'Qty (CUM)'],
          rows: [
            ['Footing F1', 6, 1.8, 1.8, 0.45, 8.75], ['Footing F2', 4, 2.1, 2.1, 0.5, 8.82], ['Footing F3', 1, 2.4, 2.4, 0.6, 3.46],
            ['Column C1 (upto plinth)', 11, 0.3, 0.45, 1.8, 2.67], ['Plinth beam PB1', 1, 48.0, 0.23, 0.45, 4.97], ['PCC below footings', 11, 2.0, 2.0, 0.1, 4.4],
          ],
        },
      },
      {
        name: 'RA Bill 02 — Brickwork & Plastering.pdf', kind: 'pdf', size: '760 KB', date: '18 Sep 2026', by: 'Masonry Contractor', note: 'Under review', department: 'Architectural', floor: 'First Floor',
        preview: { type: 'bill', billNo: 'RA-02', period: '20 Aug – 18 Sep 2026', contractor: 'Masonry Contractor', status: 'Under review', previousCertified: 185000, items: [{ desc: 'Brickwork 230 mm', unit: 'CUM', qty: 48, rate: 6400 }, { desc: 'Brickwork 115 mm', unit: 'SQM', qty: 160, rate: 780 }, { desc: 'Internal plaster 12 mm', unit: 'SQM', qty: 420, rate: 310 }] },
      },
      {
        name: 'RA Bill 01 — Terrace Waterproofing.pdf', kind: 'pdf', size: '540 KB', date: '15 Sep 2026', by: 'Waterproofing Contractor', note: 'Certified', department: 'Architectural', floor: 'Terrace',
        preview: { type: 'bill', billNo: 'RA-01', period: '01 Sep – 15 Sep 2026', contractor: 'Waterproofing Contractor', status: 'Certified', previousCertified: 0, items: [{ desc: 'APP membrane waterproofing', unit: 'SQM', qty: 180, rate: 520 }, { desc: 'Screed concrete for slope', unit: 'SQM', qty: 180, rate: 240 }, { desc: 'Rain water outlets', unit: 'NOS', qty: 4, rate: 1800 }] },
      },
      {
        name: 'RA Bill 01 — Electrical Conduiting.pdf', kind: 'pdf', size: '610 KB', date: '12 Sep 2026', by: 'Electrical Contractor', note: 'Certified', department: 'Electrical', floor: 'Ground Floor',
        preview: { type: 'bill', billNo: 'RA-01', period: '15 Aug – 12 Sep 2026', contractor: 'Electrical Contractor', status: 'Certified', previousCertified: 0, items: [{ desc: 'PVC conduit 25 mm concealed', unit: 'RMT', qty: 640, rate: 85 }, { desc: 'Metal boxes for switches', unit: 'NOS', qty: 72, rate: 120 }, { desc: 'Earthing pit', unit: 'NOS', qty: 2, rate: 8500 }] },
      },
      {
        name: 'RA Bill 02 — Electrical Wiring.pdf', kind: 'pdf', size: '580 KB', date: '22 Sep 2026', by: 'Electrical Contractor', note: 'Under review', department: 'Electrical', floor: 'First Floor',
        preview: { type: 'bill', billNo: 'RA-02', period: '13 Sep – 22 Sep 2026', contractor: 'Electrical Contractor', status: 'Under review', previousCertified: 71840, items: [{ desc: 'PVC conduit 25 mm concealed', unit: 'RMT', qty: 1180, rate: 85 }, { desc: 'Metal boxes for switches', unit: 'NOS', qty: 130, rate: 120 }, { desc: 'Earthing pit', unit: 'NOS', qty: 2, rate: 8500 }, { desc: 'FR wiring 2.5 sq mm', unit: 'RMT', qty: 900, rate: 42 }] },
      },
      {
        name: 'RA Bill 01 — Plumbing Rough-in.pdf', kind: 'pdf', size: '520 KB', date: '10 Sep 2026', by: 'Plumbing Contractor', note: 'Paid', department: 'Plumbing', floor: 'Ground Floor',
        preview: { type: 'bill', billNo: 'RA-01', period: '10 Aug – 10 Sep 2026', contractor: 'Plumbing Contractor', status: 'Paid', previousCertified: 0, items: [{ desc: 'CPVC pipe 20 mm', unit: 'RMT', qty: 220, rate: 160 }, { desc: 'uPVC SWR pipe 110 mm', unit: 'RMT', qty: 85, rate: 420 }, { desc: 'Inspection chamber', unit: 'NOS', qty: 5, rate: 4200 }] },
      },
      {
        name: 'RA Bill 01 — HVAC Ducting.pdf', kind: 'pdf', size: '640 KB', date: '19 Sep 2026', by: 'HVAC Contractor', note: 'Under review', department: 'HVAC', floor: 'Ground Floor',
        preview: { type: 'bill', billNo: 'RA-01', period: '01 Sep – 19 Sep 2026', contractor: 'HVAC Contractor', status: 'Under review', previousCertified: 0, items: [{ desc: 'GI ducting with insulation', unit: 'SQM', qty: 95, rate: 1650 }, { desc: 'Supply air diffusers', unit: 'NOS', qty: 8, rate: 2400 }, { desc: 'Copper piping for ODU', unit: 'RMT', qty: 60, rate: 950 }] },
      },
      {
        name: 'RA Bill 01 — False Ceiling.pdf', kind: 'pdf', size: '480 KB', date: '23 Sep 2026', by: 'Interior Contractor', note: 'Under review', department: 'Interior', floor: 'Ground Floor',
        preview: { type: 'bill', billNo: 'RA-01', period: '10 Sep – 23 Sep 2026', contractor: 'Interior Contractor', status: 'Under review', previousCertified: 0, items: [{ desc: 'Gypsum false ceiling', unit: 'SQM', qty: 140, rate: 950 }, { desc: 'Cove lighting profile', unit: 'RMT', qty: 48, rate: 380 }, { desc: 'Wooden rafters', unit: 'RMT', qty: 36, rate: 1450 }] },
      },
    ],
  },
  {
    id: 'quotes',
    name: 'Quotes',
    description: 'Comparative and finalised quotes',
    icon: 'pricetags-outline',
    color: '#7C3AED',
    subfolders: [
      {
        id: 'quotes-comparative',
        name: 'Comparative Quotes',
        description: 'Vendor quotes compared side by side',
        icon: 'git-compare-outline',
        color: '#7C3AED',
        files: [
          {
            name: 'Comparative Statement — Floor Tiles.xlsx', kind: 'xlsx', size: '180 KB', date: '19 Sep 2026', by: 'PMC', note: '3 vendors compared',
            preview: { type: 'comparative', title: 'Floor Tiles — Comparative Statement', vendors: ['Vendor A', 'Vendor B', 'Vendor C'], rows: [{ item: 'Vitrified 800x800', unit: 'SQM', qty: 420, rates: [720, 760, 745] }, { item: 'Anti-skid 300x300', unit: 'SQM', qty: 60, rates: [540, 520, 575] }, { item: 'Skirting 100 mm', unit: 'RMT', qty: 310, rates: [95, 110, 102] }] },
          },
          {
            name: 'Comparative Statement — Electrical Fittings.xlsx', kind: 'xlsx', size: '210 KB', date: '12 Sep 2026', by: 'PMC', note: '4 vendors compared',
            preview: { type: 'comparative', title: 'Electrical Fittings — Comparative Statement', vendors: ['Vendor A', 'Vendor B', 'Vendor C', 'Vendor D'], rows: [{ item: 'Modular switch 6A', unit: 'NOS', qty: 120, rates: [145, 138, 150, 142] }, { item: 'Socket 16A', unit: 'NOS', qty: 40, rates: [260, 275, 248, 255] }, { item: 'LED panel 18W', unit: 'NOS', qty: 36, rates: [890, 845, 910, 870] }, { item: 'MCB DB 8-way', unit: 'NOS', qty: 3, rates: [4200, 4350, 3980, 4100] }] },
          },
          {
            name: 'Comparative Statement — Sanitaryware.xlsx', kind: 'xlsx', size: '165 KB', date: '06 Sep 2026', by: 'PMC', note: '3 vendors compared',
            preview: { type: 'comparative', title: 'Sanitaryware — Comparative Statement', vendors: ['Vendor A', 'Vendor B', 'Vendor C'], rows: [{ item: 'Wall-hung WC', unit: 'NOS', qty: 4, rates: [14500, 13800, 15200] }, { item: 'Wash basin', unit: 'NOS', qty: 5, rates: [4800, 5100, 4650] }, { item: 'Health faucet', unit: 'NOS', qty: 4, rates: [1250, 1180, 1300] }] },
          },
          {
            name: 'Comparative Statement — Steel (TMT).xlsx', kind: 'xlsx', size: '150 KB', date: '20 Aug 2026', by: 'PMC', note: '5 vendors compared',
            preview: { type: 'comparative', title: 'TMT Steel Fe550 — Comparative Statement', vendors: ['Vendor A', 'Vendor B', 'Vendor C', 'Vendor D', 'Vendor E'], rows: [{ item: '8 mm', unit: 'MT', qty: 4, rates: [66500, 67200, 65800, 66900, 67500] }, { item: '12 mm', unit: 'MT', qty: 8, rates: [64800, 65400, 64200, 65000, 65900] }, { item: '16 mm', unit: 'MT', qty: 6, rates: [64500, 65100, 63900, 64700, 65600] }] },
          },
        ],
      },
      {
        id: 'quotes-finalised',
        name: 'Finalised Quotes',
        description: 'Approved quotes issued for work orders',
        icon: 'checkmark-done-outline',
        color: '#059669',
        files: [
          {
            name: 'Final Quote — Floor Tiles (Vendor A).pdf', kind: 'pdf', size: '540 KB', date: '22 Sep 2026', by: 'Client', note: 'Approved',
            preview: { type: 'quote', vendor: 'Vendor A', quoteNo: 'Q-2026-118', approvedBy: 'Client', approvedOn: '22 Sep 2026', items: [{ desc: 'Vitrified tiles 800x800', unit: 'SQM', qty: 420, rate: 720 }, { desc: 'Anti-skid tiles 300x300', unit: 'SQM', qty: 60, rate: 540 }, { desc: 'Skirting 100 mm', unit: 'RMT', qty: 310, rate: 95 }] },
          },
          {
            name: 'Final Quote — Steel TMT (Vendor C).pdf', kind: 'pdf', size: '470 KB', date: '24 Aug 2026', by: 'Client', note: 'Approved',
            preview: { type: 'quote', vendor: 'Vendor C', quoteNo: 'Q-2026-093', approvedBy: 'Client', approvedOn: '24 Aug 2026', items: [{ desc: 'TMT Fe550 — 8 mm', unit: 'MT', qty: 4, rate: 65800 }, { desc: 'TMT Fe550 — 12 mm', unit: 'MT', qty: 8, rate: 64200 }, { desc: 'TMT Fe550 — 16 mm', unit: 'MT', qty: 6, rate: 63900 }] },
          },
          {
            name: 'Final Quote — Ready-Mix Concrete.pdf', kind: 'pdf', size: '430 KB', date: '02 Aug 2026', by: 'Client', note: 'Approved',
            preview: { type: 'quote', vendor: 'RMC Supplier', quoteNo: 'Q-2026-071', approvedBy: 'Client', approvedOn: '02 Aug 2026', items: [{ desc: 'RMC M25 with pump', unit: 'CUM', qty: 85, rate: 6200 }, { desc: 'RMC M30 with pump', unit: 'CUM', qty: 40, rate: 6750 }, { desc: 'Pumping charges (lumpsum)', unit: 'LS', qty: 1, rate: 18000 }] },
          },
        ],
      },
    ],
  },
];

const KIND_STYLE: Record<FileKind, { icon: keyof typeof Ionicons.glyphMap; color: string; label: string }> = {
  pdf: { icon: 'document-text', color: '#DC2626', label: 'PDF' },
  dwg: { icon: 'construct', color: '#2563EB', label: 'DWG' },
  xlsx: { icon: 'grid', color: '#16A34A', label: 'XLSX' },
  docx: { icon: 'document', color: '#1D4ED8', label: 'DOCX' },
  img: { icon: 'image', color: '#9333EA', label: 'IMAGE' },
  other: { icon: 'document-attach', color: '#4B5563', label: 'FILE' },
};

function kindFromName(name: string, mimeType: string | null | undefined): FileKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (mimeType?.startsWith('image/')) return 'img';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'dwg') return 'dwg';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return 'xlsx';
  if (ext === 'docx' || ext === 'doc') return 'docx';
  return 'other';
}

function formatSize(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Every folder that directly holds files (Quotes itself only holds folders).
const LEAF_FOLDERS: Folder[] = FOLDERS.flatMap((f) => (f.subfolders ? f.subfolders : [f]));

function itemCount(folder: Folder, uploads: Record<string, DummyFile[]>): string {
  if (folder.subfolders) return `${folder.subfolders.length} folders`;
  const n = (folder.files?.length ?? 0) + (uploads[folder.id]?.length ?? 0);
  return `${n} file${n === 1 ? '' : 's'}`;
}

function FolderRow({ folder, count, onPress }: { folder: Folder; count: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Card className="mb-2.5 flex-row items-center gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-xl" style={{ backgroundColor: `${folder.color}1A` }}>
          <Ionicons name="folder" size={22} color={folder.color} />
        </View>
        <View className="flex-1">
          <Text className="text-sm font-bold text-neutral-900">{folder.name}</Text>
          <Text className="text-2xs text-neutral-500 mt-0.5" numberOfLines={1}>
            {folder.description}
          </Text>
        </View>
        <Text className="text-2xs text-neutral-400">{count}</Text>
        <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
      </Card>
    </Pressable>
  );
}

function FileRow({ file, onPress }: { file: DummyFile; onPress: () => void }) {
  const kind = KIND_STYLE[file.kind];
  // Transmittals get a dropdown listing every drawing they carry
  // (drawing no / revision / release date), by explicit request.
  const [expanded, setExpanded] = useState(false);
  const transmittalItems = file.preview.type === 'transmittal' ? file.preview.items : null;
  return (
    <Card className="mb-2.5">
    <Pressable onPress={onPress}>
    <View className="flex-row items-center gap-3">
      <View className="h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: `${kind.color}14` }}>
        <Ionicons name={kind.icon} size={20} color={kind.color} />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-neutral-900" numberOfLines={2}>
          {file.name}
        </Text>
        <Text className="text-2xs text-neutral-500 mt-0.5">
          {kind.label} · {file.size} · {file.date} · {file.by}
        </Text>
        {file.note && <Text className="text-2xs font-semibold text-brand-navy mt-0.5">{file.note}</Text>}
        {(file.department || file.floor) && (
          <View className="flex-row flex-wrap gap-1 mt-1">
            {file.department && (
              <View className="px-1.5 py-0.5 rounded" style={{ backgroundColor: '#EEF2FF' }}>
                <Text className="text-2xs font-semibold" style={{ color: '#4338CA' }}>{file.department}</Text>
              </View>
            )}
            {file.floor && (
              <View className="px-1.5 py-0.5 rounded" style={{ backgroundColor: '#FEF3C7' }}>
                <Text className="text-2xs font-semibold" style={{ color: '#92400E' }}>{file.floor}</Text>
              </View>
            )}
          </View>
        )}
      </View>
      <View className="flex-row items-center gap-1 px-2 py-1 rounded-lg bg-neutral-100">
        <Ionicons name="eye-outline" size={14} color="#0F1F33" />
        <Text className="text-2xs font-bold text-brand-navy">Open</Text>
      </View>
    </View>
    </Pressable>
    {transmittalItems && (
      <View className="mt-3 border-t border-neutral-100 pt-2">
        <Pressable onPress={() => setExpanded((v) => !v)} className="flex-row items-center justify-between py-1">
          <View className="flex-row items-center gap-1.5">
            <Ionicons name="layers-outline" size={14} color="#0D9488" />
            <Text className="text-xs font-bold" style={{ color: '#0D9488' }}>
              {transmittalItems.length} drawing{transmittalItems.length === 1 ? '' : 's'} in this transmittal
            </Text>
          </View>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color="#0D9488" />
        </Pressable>
        {expanded && (
          <View className="mt-1.5 rounded-lg border border-neutral-200 overflow-hidden">
            <View className="flex-row px-2 py-1.5" style={{ backgroundColor: '#F1F5F9' }}>
              <Text className="text-2xs font-bold text-neutral-700" style={{ flex: 1.2 }}>Drawing No</Text>
              <Text className="text-2xs font-bold text-neutral-700 text-center" style={{ flex: 0.8 }}>Rev</Text>
              <Text className="text-2xs font-bold text-neutral-700 text-right" style={{ flex: 1.4 }}>Release Date</Text>
            </View>
            {transmittalItems.map((it, i) => (
              <View key={i} className={`px-2 py-1.5 ${i < transmittalItems.length - 1 ? 'border-b border-neutral-100' : ''}`}>
                <View className="flex-row items-center">
                  <Text className="text-xs font-bold text-brand-navy" style={{ flex: 1.2 }}>{it.drawingNo}</Text>
                  <View style={{ flex: 0.8 }} className="items-center">
                    <View className="px-1.5 py-0.5 rounded" style={{ backgroundColor: '#FEF3C7' }}>
                      <Text className="text-2xs font-bold" style={{ color: '#92400E' }}>Rev {it.rev}</Text>
                    </View>
                  </View>
                  <Text className="text-2xs text-neutral-700 text-right" style={{ flex: 1.4 }}>{it.releaseDate}</Text>
                </View>
                <Text className="text-2xs text-neutral-500 mt-0.5">{it.title}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    )}
    </Card>
  );
}

function FilterChips({ label, options, value, onChange }: { label: string; options: string[]; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <View className="mb-2">
      <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {[null, ...options].map((opt) => {
          const active = value === opt;
          return (
            <Pressable
              key={opt ?? '__all__'}
              onPress={() => onChange(opt)}
              className={`px-3 py-1.5 rounded-full border ${active ? 'bg-brand-navy border-brand-navy' : 'bg-white border-neutral-200'}`}
            >
              <Text className={`text-xs font-semibold ${active ? 'text-white' : 'text-neutral-700'}`}>{opt ?? 'All'}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function FilesScreen() {
  // Folder navigation stack — empty = root. Kept in-screen (not separate
  // routes) since it's all static dummy data for now.
  const [path, setPath] = useState<Folder[]>([]);
  const bottomPadding = useSafeBottomOffset(24);
  const current = path[path.length - 1] ?? null;
  const folders = current ? (current.subfolders ?? []) : FOLDERS;
  const [openFile, setOpenFile] = useState<DummyFile | null>(null);
  const params = useLocalSearchParams<{ projectId?: string }>();
  const { projects, selectedProjectId: contextProjectId, isClient } = useProject();
  // A client only ever has their one project, so they skip the picker.
  const [projectId, setProjectId] = useState<string | null>(params.projectId || (isClient ? contextProjectId : null));
  useEffect(() => {
    // Re-entering from a project dashboard (param set) or from the drawer
    // (param cleared) restarts the flow at the right step.
    setProjectId(params.projectId || (isClient ? contextProjectId : null));
    setPath([]);
    setOpenFile(null);
  }, [params.projectId, isClient, contextProjectId]);
  const projectName = projects.find((p) => p.id === projectId)?.name ?? (isClient ? 'Your Project' : 'Project');
  // Uploaded files, per folder id — in memory for this session only (dummy
  // mode, nothing is sent to storage yet).
  const [uploads, setUploads] = useState<Record<string, Record<string, DummyFile[]>>>({});
  const [uploading, setUploading] = useState(false);
  const [chooseFolderOpen, setChooseFolderOpen] = useState(false);
  const [uploadBanner, setUploadBanner] = useState<string | null>(null);
  const projectUploads = uploads[projectId ?? ''] ?? {};
  const allFiles = current ? [...(projectUploads[current.id] ?? []), ...(current.files ?? [])] : [];
  // Department / Floor filters — Drawings folder only; reset on folder change.
  const [deptFilter, setDeptFilter] = useState<string | null>(null);
  const [floorFilter, setFloorFilter] = useState<string | null>(null);
  const showDrawingFilters = current?.id === 'drawings' || current?.id === 'ra-bills';
  const filterNoun = current?.id === 'ra-bills' ? 'bills' : 'drawings';
  useEffect(() => {
    setDeptFilter(null);
    setFloorFilter(null);
  }, [current?.id]);
  const files = showDrawingFilters
    ? allFiles.filter((f) => (!deptFilter || f.department === deptFilter) && (!floorFilter || f.floor === floorFilter))
    : allFiles;
  const canUploadHere = current != null && current.subfolders == null;

  async function handleUpload(target: Folder) {
    setChooseFolderOpen(false);
    setUploading(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const today = new Date();
      const date = `${String(today.getDate()).padStart(2, '0')} ${today.toLocaleString('en-US', { month: 'short' })} ${today.getFullYear()}`;
      const file: DummyFile = {
        name: asset.name,
        kind: kindFromName(asset.name, asset.mimeType),
        size: formatSize(asset.size),
        date,
        by: 'You',
        note: 'Uploaded just now',
        preview: { type: 'uploaded', uri: asset.uri, mimeType: asset.mimeType ?? null, folderName: target.name },
      };
      const pid = projectId ?? '';
      setUploads((prev) => ({ ...prev, [pid]: { ...(prev[pid] ?? {}), [target.id]: [file, ...(prev[pid]?.[target.id] ?? [])] } }));
      // Jump into the destination folder so the new file is visible right away.
      const parent = FOLDERS.find((f) => f.subfolders?.some((sf) => sf.id === target.id));
      setPath(parent ? [parent, target] : [target]);
      setUploadBanner(`"${asset.name}" uploaded to ${target.name}`);
      setTimeout(() => setUploadBanner(null), 3000);
    } finally {
      setUploading(false);
    }
  }

  if (openFile) {
    const kind = KIND_STYLE[openFile.kind];
    return (
      <FilePreview
        name={openFile.name}
        meta={`${kind.label} · ${openFile.size} · ${openFile.date} · ${openFile.by}`}
        spec={openFile.preview}
        projectName={projectName}
        onClose={() => setOpenFile(null)}
      />
    );
  }

  if (!projectId) {
    return (
      <ScrollView className="flex-1 bg-neutral-50" contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }}>
        <Text className="text-lg font-bold text-neutral-900">Select a Project</Text>
        <Text className="text-xs text-neutral-500 mt-0.5 mb-4">Files are kept per project — choose one to see its folders.</Text>
        {projects.length === 0 && <Text className="text-sm text-neutral-500">No projects available.</Text>}
        {projects.map((p) => (
          <Pressable key={p.id} onPress={() => setProjectId(p.id)}>
            <Card className="mb-2.5 flex-row items-center gap-3">
              <View className="h-11 w-11 items-center justify-center rounded-xl" style={{ backgroundColor: '#0F1F331A' }}>
                <Ionicons name="business" size={20} color="#0F1F33" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-bold text-neutral-900" numberOfLines={1}>
                  {p.name}
                </Text>
                <Text className="text-2xs text-neutral-500 mt-0.5">{LEAF_FOLDERS.length + 1} folders · Drawings, Transmittal, RA Bills, Quotes</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
            </Card>
          </Pressable>
        ))}
      </ScrollView>
    );
  }

  return (
    <ScrollView className="flex-1 bg-neutral-50" contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }}>
      {/* Breadcrumb */}
      <View className="flex-row flex-wrap items-center gap-1 mb-3">
        <Pressable
          onPress={() => {
            if (isClient) return;
            setPath([]);
            setProjectId(null);
          }}
          className="flex-row items-center gap-1"
        >
          <Ionicons name="folder-open-outline" size={14} color="#0F1F33" />
          <Text className="text-xs font-bold text-brand-navy">Files</Text>
        </Pressable>
        <View className="flex-row items-center gap-1">
          <Ionicons name="chevron-forward" size={12} color="#9CA3AF" />
          <Pressable onPress={() => setPath([])} disabled={!current}>
            <Text className={`text-xs font-bold ${current ? 'text-brand-navy' : 'text-neutral-500'}`} numberOfLines={1}>
              {projectName}
            </Text>
          </Pressable>
        </View>
        {path.map((f, i) => (
          <View key={f.id} className="flex-row items-center gap-1">
            <Ionicons name="chevron-forward" size={12} color="#9CA3AF" />
            <Pressable onPress={() => setPath(path.slice(0, i + 1))} disabled={i === path.length - 1}>
              <Text className={`text-xs font-bold ${i === path.length - 1 ? 'text-neutral-500' : 'text-brand-navy'}`}>{f.name}</Text>
            </Pressable>
          </View>
        ))}
      </View>

      <View className="flex-row items-center justify-between mb-3">
        {current || !isClient ? (
          <Pressable onPress={() => (current ? setPath(path.slice(0, -1)) : setProjectId(null))} className="flex-row items-center gap-1">
            <Ionicons name="arrow-back" size={16} color="#0F1F33" />
            <Text className="text-sm font-bold text-brand-navy">{current ? 'Back' : 'Projects'}</Text>
          </Pressable>
        ) : (
          <Text className="text-lg font-bold text-neutral-900">Project Files</Text>
        )}
        {/* Upload — straight into this folder when inside one; from the
            root (or Quotes, which only holds folders) pick a destination. */}
        <Pressable
          onPress={() => (canUploadHere && current ? void handleUpload(current) : setChooseFolderOpen((v) => !v))}
          disabled={uploading}
          className="flex-row items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-navy"
          style={{ opacity: uploading ? 0.6 : 1 }}
        >
          {uploading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="cloud-upload-outline" size={16} color="#fff" />}
          <Text className="text-xs font-bold text-white">Upload Document</Text>
        </Pressable>
      </View>

      {chooseFolderOpen && (
        <Card className="mb-3">
          <Text className="text-xs font-bold text-neutral-700 mb-2">Upload to which folder?</Text>
          <View className="flex-row flex-wrap gap-2">
            {(current?.subfolders ?? LEAF_FOLDERS).map((f) => (
              <Pressable
                key={f.id}
                onPress={() => void handleUpload(f)}
                className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-200 bg-white"
              >
                <Ionicons name="folder" size={14} color={f.color} />
                <Text className="text-xs font-semibold text-neutral-800">{f.name}</Text>
              </Pressable>
            ))}
          </View>
        </Card>
      )}

      {uploadBanner && (
        <View className="flex-row items-center gap-2 mb-3 px-3 py-2.5 rounded-xl" style={{ backgroundColor: '#DCFCE7' }}>
          <Ionicons name="checkmark-circle" size={16} color="#15803D" />
          <Text className="text-xs font-bold flex-1" style={{ color: '#15803D' }}>
            {uploadBanner}
          </Text>
        </View>
      )}

      {!current && (
        <View className="flex-row gap-2 mb-3">
          {[
            { label: 'Folders', value: String(LEAF_FOLDERS.length + 1) },
            { label: 'Documents', value: String(LEAF_FOLDERS.reduce((n, f) => n + (f.files?.length ?? 0) + (projectUploads[f.id]?.length ?? 0), 0)) },
            { label: 'Updated', value: Object.keys(projectUploads).length > 0 ? 'Today' : '23 Sep' },
          ].map((stat) => (
            <Card key={stat.label} className="flex-1 items-center py-3">
              <Text className="text-lg font-bold text-brand-navy">{stat.value}</Text>
              <Text className="text-2xs text-neutral-500">{stat.label}</Text>
            </Card>
          ))}
        </View>
      )}

      {folders.map((f) => (
        <FolderRow key={f.id} folder={f} count={itemCount(f, projectUploads)} onPress={() => setPath([...path, f])} />
      ))}
      {showDrawingFilters && (
        <Card className="mb-3">
          <FilterChips label="Department" options={DRAWING_DEPARTMENTS} value={deptFilter} onChange={setDeptFilter} />
          <FilterChips label="Floor" options={DRAWING_FLOORS} value={floorFilter} onChange={setFloorFilter} />
          <View className="flex-row items-center justify-between mt-1">
            <Text className="text-2xs text-neutral-500">
              Showing {files.length} of {allFiles.length} {filterNoun}
            </Text>
            {(deptFilter || floorFilter) && (
              <Pressable
                onPress={() => {
                  setDeptFilter(null);
                  setFloorFilter(null);
                }}
              >
                <Text className="text-2xs font-bold text-brand-navy">Clear filters</Text>
              </Pressable>
            )}
          </View>
        </Card>
      )}
      {showDrawingFilters && files.length === 0 && (
        <View className="items-center py-8">
          <Ionicons name="funnel-outline" size={28} color="#9CA3AF" />
          <Text className="text-sm font-semibold text-neutral-600 mt-2">No {filterNoun} match these filters</Text>
        </View>
      )}
      {files.map((f, i) => (
        <FileRow key={`${i}-${f.name}`} file={f} onPress={() => setOpenFile(f)} />
      ))}
    </ScrollView>
  );
}
