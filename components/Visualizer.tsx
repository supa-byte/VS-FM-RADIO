import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { audioService } from '../services/audioService';
import { ListeningMode } from '../types';

interface VisualizerProps {
  isListening: boolean;
  mode: ListeningMode;
}

export const Visualizer: React.FC<VisualizerProps> = ({ isListening, mode }) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const width = window.innerWidth;
    const height = window.innerHeight;
    const isDay = mode === ListeningMode.SUN_DAY;

    // Clear previous
    svg.selectAll("*").remove();

    // Define Colors
    const primaryColor = isDay ? "#60a5fa" : "#ef4444"; 
    // Absolute black for OLED power saving
    const bgColor = isDay ? "#f0f9ff" : "#000000";

    // --- Background Gradients ---
    const defs = svg.append("defs");
    
    // Ambient Glow
    const radialGradient = defs.append("radialGradient")
        .attr("id", "ambientGlow")
        .attr("cx", "50%")
        .attr("cy", "50%")
        .attr("r", "80%"); // Larger spread
    
    radialGradient.append("stop")
        .attr("offset", "0%")
        .attr("stop-color", isListening ? "#10b981" : primaryColor)
        .attr("stop-opacity", isDay ? 0.1 : 0.2); // Low opacity for subtle look
    radialGradient.append("stop")
        .attr("offset", "100%")
        .attr("stop-color", bgColor)
        .attr("stop-opacity", 0);

    // Background Fill
    svg.append("rect")
      .attr("width", width)
      .attr("height", height)
      .attr("fill", bgColor);

    // Ambient Glow Rect
    const glowRect = svg.append("rect")
      .attr("width", width)
      .attr("height", height)
      .attr("fill", "url(#ambientGlow)")
      .attr("opacity", 0.5);

    // --- Waveform Ring ---
    const g = svg.append("g").attr("transform", `translate(${width/2}, ${height/2})`);
    const dataPoints = 100;
    const baseRadius = Math.min(width, height) * 0.40; // Frame the buttons

    const update = () => {
      const data = audioService.getFrequencyData();
      
      const bass = d3.mean(data.slice(0, 10)) || 0;
      
      // Pulse background glow slightly with bass
      glowRect.attr("opacity", 0.3 + (bass / 600));

      const step = Math.ceil(data.length / dataPoints);
      const sampledData = [];
      for(let i=0; i<dataPoints; i++) {
        sampledData.push(data[i * step] || 0);
      }

      const angleStep = (Math.PI * 2) / dataPoints;
      
      const line = d3.lineRadial<number>()
        .angle((d, i) => i * angleStep)
        .radius((d) => baseRadius + (d * 0.5)) 
        .curve(d3.curveBasisClosed);

      const path = g.selectAll(".waveform").data([sampledData]);

      path.enter()
        .append("path")
        .attr("class", "waveform")
        .merge(path as any)
        .attr("d", line)
        .attr("fill", "none")
        .attr("stroke", isListening ? "#34d399" : primaryColor)
        .attr("stroke-width", 1)
        .attr("stroke-opacity", 0.3)
        .style("filter", `blur(${isDay ? 1 : 2}px)`);

      path.exit().remove();

      requestAnimationFrame(update);
    };

    update();

  }, [isListening, mode]);

  return (
    <div className="absolute inset-0 pointer-events-none z-0 transition-colors duration-1000 bg-black">
      <svg ref={svgRef} width="100%" height="100%" />
    </div>
  );
};