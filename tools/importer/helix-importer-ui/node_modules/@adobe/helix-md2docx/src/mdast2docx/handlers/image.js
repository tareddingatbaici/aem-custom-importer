/*
 * Copyright 2021 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import {
  Drawing, ImageRun, XmlComponent, XmlAttributeComponent,
} from 'docx';
import { findXMLComponent } from '../utils.js';

// max image width (6.5") and height (2")
const LIMITS = {
  width: 914400 * 6.5,
  height: 914400 * 2.0,
};

// max image width (2") and height (1") in tables
const LIMITS_TABLE = {
  width: 914400 * 2.0,
  height: 914400,
};

export default async function image(ctx, node) {
  const { data } = node;
  if (!data) {
    return undefined;
  }
  let x = data.dimensions.width * 9525;
  let y = data.dimensions.height * 9525;
  const limits = ctx.tableAlign ? LIMITS_TABLE : LIMITS;
  if (x > limits.width) {
    y = Math.round((limits.width * y) / x);
    x = limits.width;
  }
  if (y > limits.height) {
    x = Math.round((limits.height * x) / y);
    y = limits.height;
  }

  const imageData = {
    stream: data.buffer,
    fileName: data.key,
    transformation: {
      pixels: {
        x: Math.round(data.dimensions.width),
        y: Math.round(data.dimensions.height),
      },
      emus: {
        x,
        y,
      },
    },
  };

  const drawing = new Drawing(imageData, {
    floating: false,
    docProperties: {
      title: node.title || '',
      description: node.alt || '',
      name: node.title || node.alt || '',
    },
  });

  // create picture
  const pic = new ImageRun({
    data: data.buffer,
    transformation: data.dimensions,
  });
  // replace drawing
  const oldDrawing = findXMLComponent(pic, 'w:drawing');
  const idx = pic.root.indexOf(oldDrawing);
  if (idx >= 0) {
    pic.root.splice(idx, 1);
  }
  pic.root.push(drawing);
  pic.key = data.key;
  pic.imageData = imageData;

  // for SVGs, we need to generate a proper svgBlip
  /*
  <pic:blipFill>
    <a:blip r:embed="rId4">
      <a:extLst>
        <a:ext uri="{28A0092B-C50C-407E-A947-70E740481C1C}">
          <a14:useLocalDpi val="0" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"/>
        </a:ext>
        <a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}">
          <asvg:svgBlip r:embed="rId5" xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main"/>
        </a:ext>
      </a:extLst>
    </a:blip>
    <a:stretch>
      <a:fillRect/>
    </a:stretch>
  </pic:blipFill>
   */

  class SvgBlip extends XmlComponent {
    constructor(imgData) {
      super('asvg:svgBlip');
      this.imageData = imgData;
      this.addChildElement(new XmlAttributeComponent({
        'xmlns:asvg': 'http://schemas.microsoft.com/office/drawing/2016/SVG/main',
        'r:embed': `rId{${imgData.fileName}}`,
      }));
    }

    prepForXml(context) {
      // add the svg data if it has a stream
      if (this.imageData.stream) {
        context.file.Media.addImage(this.imageData.fileName, this.imageData);
      }

      // add svg content type if missing
      if (!context.file.contentTypes.root.find((entry) => entry.rootKey === 'Default'
          && (entry.root[0].root.extension === 'svg' || entry.root[0].root.Extension === 'svg'))) {
        context.file.contentTypes.root.push(new XmlComponent('Default').addChildElement(new XmlAttributeComponent({
          ContentType: 'image/svg+xml',
          Extension: 'svg',
        })));
      }
      return super.prepForXml(context);
    }
  }

  if (data.originalType === 'image/svg') {
    // create a fake image run for the svg image
    const ir = new ImageRun({
      data: data.originalBuffer,
      transformation: data.dimensions,
    });
    ir.imageData.fileName = data.svgKey;

    const blipFill = findXMLComponent(drawing, 'wp:inline/a:graphic/a:graphicData/pic:pic/pic:blipFill');
    const blip = findXMLComponent(blipFill, 'a:blip');

    // const blipAttrs = findXMLComponent(oldBlip, '_attr');
    // blipAttrs.root.embed = `rId{${ir.imageData.fileName}}`;

    // add svg stuff
    // const newBlip = new XmlComponent('a:blip')
    blip
      .addChildElement(new XmlComponent('a:extLst')
        .addChildElement(new XmlComponent('a:ext')
          .addChildElement(new XmlAttributeComponent({
            uri: '{28A0092B-C50C-407E-A947-70E740481C1C}',
          }))
          .addChildElement(new XmlComponent('a14:useLocalDpi')
            .addChildElement(new XmlAttributeComponent({
              'xmlns:a14': 'http://schemas.microsoft.com/office/drawing/2010/main',
              val: '0',
            }))))
        .addChildElement(new XmlComponent('a:ext')
          .addChildElement(new XmlAttributeComponent({
            uri: '{96DAC541-7B7A-43D3-8B79-37D633B846F1}',
          }))
          .addChildElement(new SvgBlip(ir.imageData))));

    // replace blip
    // blipFill.root.splice(blipFill.root.indexOf(oldBlip), 1, newBlip);
  }
  return pic;
}
